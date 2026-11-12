<?php
require __DIR__ . '/hass.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendError(405, 'Use POST.');
}

if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
    sendError(415, 'Expected JSON.');
}

$input = json_decode(file_get_contents('php://input'), true);

if (!is_array($input)) {
    sendError(400, 'Invalid request.');
}

$_GET['room'] = $input['room'] ?? '';
$roomId = requireRoomId();

$entityIds = $input['entity_ids'] ?? null;
$action = is_string($input['action'] ?? null) ? $input['action'] : '';

if (!is_array($entityIds) || !$entityIds || !array_is_list($entityIds)
    || array_filter($entityIds, fn($entityId): bool => !is_string($entityId))) {
    sendError(400, 'Invalid devices.');
}

$entityIds = array_values(array_unique($entityIds));

const COMMANDS = [
    'turn_on'         => ['light', 'switch', 'fan', 'input_boolean', 'climate'],
    'turn_off'        => ['light', 'switch', 'fan', 'input_boolean', 'climate'],
    'open_cover'      => ['cover'],
    'close_cover'     => ['cover'],
    'stop_cover'      => ['cover'],
    'set_temperature' => ['climate'],
    'set_brightness'  => ['light'],
    'set_position'    => ['cover'],
    'set_mode'        => ['select'],
];

function skipDevices(array $targets, array $roomDevices, array &$failures, callable $canRun, string $problem): array
{
    return array_values(array_filter($targets, function (string $entityId) use ($roomDevices, &$failures, $canRun, $problem): bool {
        if ($canRun($roomDevices[$entityId])) {
            return true;
        }

        $failures[$entityId] = "{$roomDevices[$entityId]['name']} $problem";

        return false;
    }));
}

function logDeviceCommand(array $outcomes, array $params, array $roomDevices, string $service): void
{
    if (!$outcomes) {
        return;
    }

    try {
        ob_start();
        require __DIR__ . '/../../connection.php';
        ob_end_clean();

        if (!isset($pdo)) {
            return;
        }

        foreach ($outcomes as $entityId => $ok) {
            logDeviceControl($pdo, $entityId, $roomDevices[$entityId]['name'], $service, $params, null, $ok, (int) $_SESSION['user_id']);
        }
    } catch (PDOException $e) {
        error_log('Logging device command failed: ' . $e->getMessage());
    }
}

function sendCommandFailure(int $status, string $message, array $failures): void
{
    $results = [];

    foreach ($failures as $entityId => $error) {
        $results[$entityId] = ['ok' => false, 'error' => $error];
    }

    http_response_code($status);
    echo json_encode(['error' => $message, 'results' => $results]);
    exit;
}

if (!isset(COMMANDS[$action])) {
    sendError(400, 'This action is not supported for the device.');
}

$roomDevices = array_column(roomDevices($config, $roomId), null, 'entity_id');
$targets = [];
$failures = [];
$domain = null;

foreach ($entityIds as $entityId) {
    if (!isset($roomDevices[$entityId])) {
        $failures[$entityId] = 'Device not found in this room.';
        continue;
    }

    $deviceDomain = explode('.', $entityId)[0];

    if ($domain !== null && $deviceDomain !== $domain) {
        sendError(400, 'All devices must be of the same type.');
    }

    $domain = $deviceDomain;
    $targets[] = $entityId;
}

if ($domain !== null && !in_array($domain, COMMANDS[$action], true)) {
    sendError(400, 'This action is not supported for the device.');
}

$targets = skipDevices(
    $targets,
    $roomDevices,
    $failures,
    fn(array $device): bool => $device['state'] !== 'unavailable',
    'is unavailable right now.'
);

$params = [];
$service = $action;

if ($action === 'set_temperature') {
    if (count($entityIds) !== 1) {
        sendError(400, 'Set the temperature one device at a time.');
    }

    $value = $input['value'] ?? null;

    if (!is_int($value) && !is_float($value)) {
        sendError(400, 'Invalid temperature.');
    }

    if ($targets) {
        $device = $roomDevices[$targets[0]];
        $min = numericState($device['min']) ?? 7.0;
        $max = numericState($device['max']) ?? 35.0;

        if ($value < $min || $value > $max) {
            sendError(400, "Temperature must be between $min and $max °C.");
        }
    }

    $params['temperature'] = $value;
}

if ($domain === 'climate' && ($action === 'turn_on' || $action === 'turn_off')) {
    $targets = skipDevices($targets, $roomDevices, $failures, 'canSwitchHeating', 'cannot be switched on or off.');

    $service = 'set_hvac_mode';
    $params['hvac_mode'] = $action === 'turn_on' ? 'heat' : 'off';
}

if ($action === 'set_brightness') {
    $value = $input['value'] ?? null;

    if (!is_int($value) || $value < 0 || $value > 100) {
        sendError(400, 'Brightness must be a whole number from 0 to 100.');
    }

    $targets = skipDevices($targets, $roomDevices, $failures, 'isDimmable', 'cannot be dimmed.');

    $service = 'turn_on';
    $params['brightness_pct'] = $value;
}

if ($action === 'set_position') {
    $value = $input['value'] ?? null;

    if (!is_int($value) || $value < 0 || $value > 100) {
        sendError(400, 'Position must be a whole number from 0 to 100.');
    }

    $targets = skipDevices($targets, $roomDevices, $failures, 'supportsPosition', 'cannot be set to a position.');

    $service = 'set_cover_position';
    $params['position'] = $value;
}

if ($action === 'set_mode') {
    $value = $input['value'] ?? null;

    $targets = skipDevices(
        $targets,
        $roomDevices,
        $failures,
        fn(array $device): bool => is_string($value) && in_array($value, $device['options'], true),
        'does not have this mode.'
    );

    $service = 'select_option';
    $params['option'] = $value;
}

$skipped = array_fill_keys(array_keys(array_intersect_key($failures, $roomDevices)), false);

if (!$targets) {
    logDeviceCommand($skipped, $params, $roomDevices, $service);

    sendCommandFailure(
        409,
        count($failures) === 1 ? reset($failures) : 'None of the ' . count($failures) . ' devices could be controlled.',
        $failures
    );
}

try {
    hassCall($config, "/api/services/$domain/$service", ['entity_id' => $targets] + $params);
} catch (HassException $e) {
    logDeviceCommand($skipped + array_fill_keys($targets, false), $params, $roomDevices, $service);

    sendCommandFailure(502, $e->getMessage(), $failures + array_fill_keys($targets, $e->getMessage()));
}

logDeviceCommand($skipped + array_fill_keys($targets, true), $params, $roomDevices, $service);

$results = array_fill_keys($targets, ['ok' => true]);

foreach ($failures as $entityId => $error) {
    $results[$entityId] = ['ok' => false, 'error' => $error];
}

echo json_encode(['ok' => true, 'results' => $results]);
