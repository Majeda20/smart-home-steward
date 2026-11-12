<?php
require __DIR__ . '/../../session.php';

header('Content-Type: application/json');

function sendError(int $status, string $message): void
{
    http_response_code($status);
    echo json_encode(['error' => $message]);
    exit;
}

if (!isLoggedIn()) {
    sendError(401, 'Not logged in.');
}

session_write_close();

require_once __DIR__ . '/hass-client.php';

set_exception_handler(function (Throwable $e): void {
    if ($e instanceof HassException) {
        sendError(502, $e->getMessage());
    }

    error_log('Unhandled error: ' . $e->getMessage());
    sendError(500, 'Something went wrong. Please try again.');
});

$config = loadHassConfig();

if (empty($config['hass_url']) || empty($config['hass_token'])) {
    error_log('Home Assistant settings are missing.');
    sendError(500, 'Home Assistant is not configured (see config.example.php).');
}

const SENSOR_TYPES = [
    'temperature'    => ['label' => 'Temperature'],
    'humidity'       => ['label' => 'Humidity'],
    'carbon_dioxide' => ['label' => 'CO₂'],
    'sound_pressure' => ['label' => 'Noise'],
    'illuminance'    => ['label' => 'Light level'],
    'power'          => ['label' => 'Power', 'sum' => true],
    'irradiance'     => ['label' => 'Solar irradiance'],
];

function requireRoomId(): string
{
    $roomId = $_GET['room'] ?? '';

    if (!preg_match('/^[a-z0-9_]+$/', $roomId)) {
        sendError(400, 'Invalid room.');
    }

    return $roomId;
}

function roomSensors(array $config, string $roomId): array
{
    $template = '{% if area_name("' . $roomId . '") is none %}null{% else %}'
        . '{% set ns = namespace(sensors=[]) %}'
        . '{% for e in area_entities("' . $roomId . '") %}'
        . '{% if e.startswith("sensor.")'
        . ' and state_attr(e, "state_class") == "measurement"'
        . ' and state_attr(e, "device_class") != "battery" %}'
        . '{% set ns.sensors = ns.sensors + [{'
        . '"entity_id": e,'
        . '"name": state_attr(e, "friendly_name") or e,'
        . '"device": device_attr(device_id(e), "name") or state_attr(e, "friendly_name") or e,'
        . '"device_class": state_attr(e, "device_class"),'
        . '"unit": state_attr(e, "unit_of_measurement") or "",'
        . '"state": states(e),'
        . '"updated": (expand(e) | first).last_updated.isoformat()'
        . '}] %}'
        . '{% endif %}'
        . '{% endfor %}'
        . '{{ ns.sensors | tojson }}'
        . '{% endif %}';

    $response = hassCall($config, '/api/template', ['template' => $template]);

    if (trim($response) === 'null') {
        sendError(404, 'Room not found.');
    }

    $sensors = json_decode($response, true);

    if (!is_array($sensors)) {
        error_log('Unexpected Home Assistant response: ' . substr($response, 0, 500));
        sendError(502, 'Unexpected response from Home Assistant.');
    }

    return $sensors;
}

const CONTROL_DOMAINS = ['light', 'switch', 'fan', 'input_boolean', 'climate', 'cover'];

const OPENING_CLASSES = ['door', 'window', 'garage_door', 'opening'];

const PRESENCE_CLASSES = ['motion', 'occupancy', 'presence'];

function roomDevices(array $config, string $roomId): array
{
    $domains = json_encode(CONTROL_DOMAINS);
    $openings = json_encode(array_merge(OPENING_CLASSES, PRESENCE_CLASSES));

    $template = <<<JINJA
        {% if area_name("$roomId") is none %}
            null
        {% else %}
            {% set ns = namespace(devices=[]) %}

            {% for e in area_entities("$roomId")
                if e.split(".")[0] in $domains
                or e.startswith("select.ventilation")
                or (e.startswith("binary_sensor.") and state_attr(e, "device_class") in $openings) %}
                {% set flow = namespace(state=none, unit="") %}
                {% if e.startswith("select.") and device_id(e) %}
                    {% for s in device_entities(device_id(e))
                        if s.startswith("sensor.") and state_attr(s, "unit_of_measurement") == "m³/h" %}
                        {% set flow.state = states(s) %}
                        {% set flow.unit = state_attr(s, "unit_of_measurement") %}
                    {% endfor %}
                {% endif %}
                {% set ns.devices = ns.devices + [{
                    "entity_id":   e,
                    "name":        state_attr(e, "friendly_name") or e,
                    "state":       states(e),
                    "class":       state_attr(e, "device_class"),
                    "target":      state_attr(e, "temperature"),
                    "current":     state_attr(e, "current_temperature"),
                    "min":         state_attr(e, "min_temp"),
                    "max":         state_attr(e, "max_temp"),
                    "step":        state_attr(e, "target_temp_step"),
                    "hvac_modes":  state_attr(e, "hvac_modes") or [],
                    "color_modes": state_attr(e, "supported_color_modes") or [],
                    "brightness":  state_attr(e, "brightness"),
                    "position":    state_attr(e, "current_position"),
                    "features":    state_attr(e, "supported_features") or 0,
                    "options":     state_attr(e, "options") or [],
                    "airflow":     flow.state,
                    "flow_unit":   flow.unit
                }] %}
            {% endfor %}

            {{ ns.devices | tojson }}
        {% endif %}
        JINJA;

    $response = hassCall($config, '/api/template', ['template' => $template]);

    if (trim($response) === 'null') {
        sendError(404, 'Room not found.');
    }

    $devices = json_decode($response, true);

    if (!is_array($devices)) {
        error_log('Unexpected Home Assistant response: ' . substr($response, 0, 500));
        sendError(502, 'Unexpected response from Home Assistant.');
    }

    return $devices;
}

function canSwitchHeating(array $device): bool
{
    return str_starts_with($device['entity_id'], 'climate.')
        && !array_diff(['off', 'heat'], $device['hvac_modes']);
}

function isDimmable(array $device): bool
{
    return (bool) array_diff($device['color_modes'], ['onoff', 'unknown']);
}

const COVER_SET_POSITION = 4;

function supportsPosition(array $device): bool
{
    return str_starts_with($device['entity_id'], 'cover.')
        && ((int) $device['features'] & COVER_SET_POSITION) !== 0;
}

function sensorGroups(array $sensors): array
{
    $groups = [];

    foreach ($sensors as $sensor) {
        $class = $sensor['device_class'];
        $key = $class ?: $sensor['entity_id'];

        if (!isset($groups[$key])) {
            $type = SENSOR_TYPES[$class] ?? null;

            $groups[$key] = [
                'key'     => $key,
                'type'    => $class ?: 'other',
                'label'   => $type['label'] ?? ($class ? ucfirst(str_replace('_', ' ', $class)) : $sensor['name']),
                'unit'    => $sensor['unit'],
                'sum'     => !empty($type['sum']),
                'sensors' => [],
            ];
        }

        $groups[$key]['sensors'][] = $sensor;
    }

    $order = array_flip(array_keys(SENSOR_TYPES));

    uasort($groups, function (array $a, array $b) use ($order): int {
        return [$order[$a['type']] ?? PHP_INT_MAX, $a['label']]
            <=> [$order[$b['type']] ?? PHP_INT_MAX, $b['label']];
    });

    return $groups;
}

function requireMetricKey(): string
{
    $key = $_GET['metric'] ?? '';

    if (!preg_match('/^[a-z0-9_.]+$/', $key)) {
        sendError(400, 'Invalid metric.');
    }

    return $key;
}
