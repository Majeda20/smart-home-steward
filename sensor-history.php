<?php
require __DIR__ . '/hass.php';
require_once __DIR__ . '/../../user-preferences.php';

const PERIODS = [
    '1h'  => ['count' => 13, 'step' => 5],
    '24h' => ['count' => 25, 'step' => 60],
    '7d'  => ['count' => 29, 'step' => 360],
    '30d' => ['count' => 31, 'step' => 1440],
];

$roomId = requireRoomId();
$metric = requireMetricKey();
$periodKey = $_GET['period'] ?? '';

if (!isset(PERIODS[$periodKey])) {
    sendError(400, 'Invalid period.');
}

['count' => $count, 'step' => $stepMinutes] = PERIODS[$periodKey];
$step = $stepMinutes * 60;

$now = new DateTimeImmutable('now');
$minutesToday = (int) $now->format('G') * 60 + (int) $now->format('i');
$lastStart = $now
    ->setTime(0, 0)
    ->modify('+' . (intdiv($minutesToday, $stepMinutes) * $stepMinutes) . ' minutes')
    ->getTimestamp();
$firstStart = $lastStart - ($count - 1) * $step;

$groups = sensorGroups(roomSensors($config, $roomId));

if (!isset($groups[$metric])) {
    sendError(404, 'This room has no such sensor.');
}

$preferences = currentPreferences();
$isTemperature = isCelsiusUnit($groups[$metric]['unit']);
$sumSensors = $groups[$metric]['sum'];
$entityIds = array_column($groups[$metric]['sensors'], 'entity_id');

$buckets = array_fill(0, $count, ['sum' => 0.0, 'n' => 0]);
$end = $now->getTimestamp();

if ($entityIds) {
    $query = http_build_query([
        'filter_entity_id' => implode(',', $entityIds),
        'end_time'         => gmdate('Y-m-d\TH:i:s\Z', $now->getTimestamp()),
    ]) . '&minimal_response&no_attributes';

    $history = hassRequest(
        $config,
        '/api/history/period/' . gmdate('Y-m-d\TH:i:s\Z', $firstStart) . '?' . $query,
        null,
        60
    );

    foreach ($history as $series) {
        $weighted = array_fill(0, $count, ['sum' => 0.0, 'seconds' => 0]);
        $total = count($series);

        foreach ($series as $i => $state) {
            $value = numericState($state['state'] ?? null);
            $from = strtotime($state['last_changed'] ?? '');

            if ($value === null || $from === false) {
                continue;
            }

            $until = $i + 1 < $total ? strtotime($series[$i + 1]['last_changed']) : $end;
            $from = max($from, $firstStart);
            $until = min($until, $end);

            while ($from < $until) {
                $index = intdiv($from - $firstStart, $step);

                if ($index >= $count) {
                    break;
                }

                $bucketEnd = min($firstStart + ($index + 1) * $step, $until);
                $weighted[$index]['sum'] += $value * ($bucketEnd - $from);
                $weighted[$index]['seconds'] += $bucketEnd - $from;
                $from = $bucketEnd;
            }
        }

        foreach ($weighted as $index => $bucket) {
            if ($bucket['seconds'] > 0) {
                $buckets[$index]['sum'] += $bucket['sum'] / $bucket['seconds'];
                $buckets[$index]['n']++;
            }
        }
    }
}

$points = [];
foreach ($buckets as $index => $bucket) {
    $value = null;

    if ($bucket['n'] > 0) {
        $value = $sumSensors ? $bucket['sum'] : $bucket['sum'] / $bucket['n'];

        if ($isTemperature) {
            $value = displayTemperature($value, $preferences);
        }
    }

    $points[] = [
        'time'  => ($firstStart + $index * $step) * 1000,
        'value' => $value,
    ];
}

echo json_encode([
    'sensors' => count($entityIds),
    'sum'     => $sumSensors,
    'points'  => $points,
]);
