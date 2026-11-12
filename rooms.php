<?php
require __DIR__ . '/hass.php';
require_once __DIR__ . '/../../user-preferences.php';

$template = '{% set ns = namespace(rooms=[]) %}'
    . '{% for a in areas() %}'
    . '{% set ns.rooms = ns.rooms + [{"id": a, "name": area_name(a)}] %}'
    . '{% endfor %}'
    . '{{ ns.rooms | tojson }}';

$rooms = hassRequest($config, '/api/template', ['template' => $template]);
$hiddenRooms = currentPreferences()['hidden_rooms'];

if (($_GET['all'] ?? '') === '1') {
    echo json_encode(['rooms' => array_map(function (array $room) use ($hiddenRooms): array {
        return $room + ['hidden' => in_array($room['id'], $hiddenRooms, true)];
    }, $rooms)]);
    exit;
}

$visibleRooms = array_values(array_filter($rooms, function (array $room) use ($hiddenRooms): bool {
    return !in_array($room['id'], $hiddenRooms, true);
}));

echo json_encode([
    'rooms'  => $visibleRooms,
    'hidden' => count($rooms) - count($visibleRooms),
]);
