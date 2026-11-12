<?php
require __DIR__ . '/hass.php';
require_once __DIR__ . '/../../user-preferences.php';

$roomId = requireRoomId();
$groups = sensorGroups(roomSensors($config, $roomId));
$preferences = currentPreferences();

$metrics = [];

$devices = [];
$updated = null;

foreach ($groups as $key => $group) {
    $isTemperature = isCelsiusUnit($group['unit']);

    if ($isTemperature) {
        $group['unit'] = displayTemperatureUnit($preferences);
    }

    $values = [];

    foreach ($group['sensors'] as $sensor) {
        $value = numericState($sensor['state']);

        if ($isTemperature) {
            $value = displayTemperature($value, $preferences);
        }
        $name = $sensor['device'];

        if (!isset($devices[$name])) {
            $devices[$name] = ['name' => $name, 'available' => false, 'readings' => []];
        }

        $devices[$name]['readings'][$key] = $value;

        if ($value === null) {
            continue;
        }

        $devices[$name]['available'] = true;
        $values[] = $value;

        if ($updated === null || $sensor['updated'] > $updated) {
            $updated = $sensor['updated'];
        }
    }

    $total = $values ? array_sum($values) : null;

    $metrics[] = [
        'key'   => $key,
        'type'  => $group['type'],
        'label' => $group['label'],
        'unit'  => $group['unit'],
        'sum'   => $group['sum'],
        'value' => $total === null ? null : ($group['sum'] ? $total : $total / count($values)),
        'count' => count($values),
    ];
}

echo json_encode([
    'metrics' => $metrics,
    'sensors' => array_values($devices),
    'updated' => $updated,
]);
