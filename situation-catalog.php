<?php

const SITUATION_ENTITIES = [
    'window'      => ['label' => 'Window', 'kind' => 'state', 'states' => ['open', 'closed']],
    'door'        => ['label' => 'Door', 'kind' => 'state', 'states' => ['open', 'closed']],
    'motion'      => ['label' => 'Motion', 'kind' => 'state', 'states' => ['detected', 'clear']],
    'presence'    => ['label' => 'Presence', 'kind' => 'state', 'states' => ['detected', 'clear']],
    'people'      => ['label' => 'People count', 'kind' => 'number', 'unit' => 'people'],
    'temperature' => ['label' => 'Temperature', 'kind' => 'number', 'unit' => '°C'],
    'humidity'    => ['label' => 'Humidity', 'kind' => 'number', 'unit' => '%'],
    'co2'         => ['label' => 'CO₂', 'kind' => 'number', 'unit' => 'ppm'],
    'noise'       => ['label' => 'Noise', 'kind' => 'number', 'unit' => 'dB'],
    'illuminance' => ['label' => 'Light level', 'kind' => 'number', 'unit' => 'lx'],
    'power'       => ['label' => 'Power use', 'kind' => 'number', 'unit' => 'W'],
    'light'       => ['label' => 'Lights', 'kind' => 'state', 'states' => ['on', 'off'], 'device' => true,
                      'settable' => ['name' => 'brightness', 'unit' => '%', 'min' => 0, 'max' => 100, 'step' => 1]],
    'switch'      => ['label' => 'Switches (PCs, TVs...)', 'kind' => 'state', 'states' => ['on', 'off'], 'device' => true],
    'radiator'    => ['label' => 'Radiator', 'kind' => 'state', 'states' => ['on', 'off'], 'device' => true],
    'thermostat'  => ['label' => 'Radiator target', 'kind' => 'number', 'unit' => '°C',
                      'settable' => ['name' => 'temperature', 'unit' => '°C', 'min' => 5, 'max' => 30, 'step' => 0.5]],
    'ventilation' => ['label' => 'Ventilation', 'kind' => 'state', 'states' => ['low', 'normal', 'boost'],
                      'settable' => ['name' => 'mode', 'options' => ['low', 'normal', 'boost']]],
    'availability' => ['label' => 'Any device or sensor', 'kind' => 'state', 'states' => ['unavailable', 'available']],
    'time'        => ['label' => 'Time of day', 'kind' => 'time', 'global' => true],
];

const SITUATION_OPERATORS = [
    'state'  => ['is', 'is_not'],
    'number' => ['above', 'below', 'equals'],
    'time'   => ['between'],
];

const SITUATION_ACTIONS = ['turn_on', 'turn_off', 'set_value'];

const SHOWN_DEVICE_DOMAINS = ['light', 'switch', 'fan', 'input_boolean', 'climate', 'cover'];

const SHOWN_BINARY_CLASSES = ['door', 'window', 'garage_door', 'opening', 'motion', 'occupancy', 'presence'];

function isShownInApp(array $entity): bool
{
    $entityId = $entity['entity_id'];
    $domain = explode('.', $entityId)[0];

    return in_array($domain, SHOWN_DEVICE_DOMAINS, true)
        || str_starts_with($entityId, 'select.ventilation')
        || ($domain === 'binary_sensor' && in_array($entity['class'], SHOWN_BINARY_CLASSES, true))
        || ($domain === 'sensor' && $entity['state_class'] === 'measurement' && $entity['class'] !== 'battery');
}

const SITUATION_SENSOR_CLASSES = [
    'temperature'    => 'temperature',
    'humidity'       => 'humidity',
    'carbon_dioxide' => 'co2',
    'sound_pressure' => 'noise',
    'illuminance'    => 'illuminance',
    'power'          => 'power',
];

function situationEntityKeys(array $entity): array
{
    $entityId = $entity['entity_id'];
    $domain = explode('.', $entityId)[0];
    $class = $entity['class'];

    if ($domain === 'binary_sensor') {
        return match ($class) {
            'window'                            => ['window'],
            'door', 'garage_door', 'opening'    => ['door'],
            'motion'                            => ['motion'],
            'occupancy', 'presence'             => ['presence'],
            default                             => [],
        };
    }

    if ($domain === 'sensor' && $entity['state_class'] === 'measurement') {
        if (isset(SITUATION_SENSOR_CLASSES[$class])) {
            return [SITUATION_SENSOR_CLASSES[$class]];
        }

        return str_starts_with($entityId, 'sensor.people_') ? ['people'] : [];
    }

    return match ($domain) {
        'light'   => ['light'],
        'switch'  => ['switch'],
        'climate' => ['radiator', 'thermostat'],
        'select'  => str_starts_with($entityId, 'select.ventilation') ? ['ventilation'] : [],
        default   => [],
    };
}

function situationRooms(array $config): array
{
    $template = <<<'JINJA'
        {% set ns = namespace(rooms=[]) %}
        {% for a in areas() %}
            {% set es = namespace(list=[]) %}
            {% for e in area_entities(a) %}
                {% set es.list = es.list + [{
                    "entity_id":   e,
                    "name":        state_attr(e, "friendly_name") or e,
                    "class":       state_attr(e, "device_class"),
                    "state_class": state_attr(e, "state_class")
                }] %}
            {% endfor %}
            {% set ns.rooms = ns.rooms + [{"id": a, "name": area_name(a), "entities": es.list}] %}
        {% endfor %}
        {{ ns.rooms | tojson }}
        JINJA;

    $rooms = [];

    foreach (hassRequest($config, '/api/template', ['template' => $template]) as $area) {
        $entities = [];
        $names = [];

        foreach ($area['entities'] as $entity) {
            $keys = situationEntityKeys($entity);
            $names[$entity['entity_id']] = $entity['name'];

            foreach ($keys as $key) {
                $entities[$key][] = $entity['entity_id'];
            }

            if (isShownInApp($entity)) {
                $entities['availability'][] = $entity['entity_id'];
            }
        }

        if ($entities) {
            $rooms[$area['id']] = [
                'id'       => $area['id'],
                'name'     => $area['name'],
                'entities' => $entities,
                'names'    => $names,
            ];
        }
    }

    return $rooms;
}
