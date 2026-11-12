<?php
require __DIR__ . '/hass.php';

$roomId = requireRoomId();

$devices = [];

foreach (roomDevices($config, $roomId) as $entity) {
    $state = $entity['state'];
    $domain = explode('.', $entity['entity_id'])[0];

    if ($domain === 'binary_sensor' && in_array($entity['class'], PRESENCE_CLASSES, true)) {
        $domain = $entity['class'] === 'motion' ? 'motion' : 'presence';
        $state = ['on' => 'detected', 'off' => 'clear'][$state] ?? $state;
    } elseif ($domain === 'binary_sensor') {
        $domain = $entity['class'] === 'window' ? 'window' : 'door';
        $state = ['on' => 'open', 'off' => 'closed'][$state] ?? $state;
    }

    if ($domain === 'select') {
        $domain = 'ventilation';
    }

    $device = [
        'entity_id'    => $entity['entity_id'],
        'domain'       => $domain,
        'name'         => $entity['name'],
        'state'        => $state,
        'availability' => $state === 'unavailable' ? 'unavailable'
            : ($state === 'unknown' ? 'unknown' : 'available'),
    ];

    if ($device['domain'] === 'climate') {
        $device['climate'] = [
            'target'  => numericState($entity['target']),
            'current' => numericState($entity['current']),
            'min'     => numericState($entity['min']) ?? 7.0,
            'max'     => numericState($entity['max']) ?? 35.0,
            'step'    => numericState($entity['step']) ?? 0.5,
            'switch'  => canSwitchHeating($entity),
        ];
    }

    if ($device['domain'] === 'light' && isDimmable($entity)) {
        $brightness = numericState($entity['brightness']);

        $device['light'] = [
            'brightness' => $state === 'on' && $brightness !== null
                ? (int) round($brightness / 255 * 100)
                : 0,
        ];
    }

    if ($domain === 'ventilation') {
        $airflow = numericState($entity['airflow']);

        $device['ventilation'] = [
            'modes'   => array_values(array_filter($entity['options'], 'is_string')),
            'airflow' => $airflow === null ? null : (int) round($airflow),
            'unit'    => $entity['flow_unit'],
        ];
    }

    if (supportsPosition($entity)) {
        $position = numericState($entity['position']);

        $device['cover'] = [
            'position' => $position === null ? null : (int) round($position),
        ];
    }

    $devices[] = $device;
}

echo json_encode(['devices' => $devices]);
