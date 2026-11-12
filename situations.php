<?php
require __DIR__ . '/hass.php';
require_once __DIR__ . '/../../checker/situation-engine.php';

const SITUATION_LIST_DAYS = 30;
const SITUATION_LIST_LIMIT = 200;

const SITUATION_CHANGES = [
    'acknowledge' => ['from' => ['active'], 'to' => 'acknowledged', 'logged' => 'acknowledged'],
    'dismiss'     => ['from' => ['active', 'acknowledged'], 'to' => 'dismissed', 'logged' => 'dismissed'],
    'restore'     => ['from' => ['dismissed'], 'to' => 'active', 'logged' => null],
    'run'         => ['from' => ['active', 'acknowledged', 'dismissed'], 'to' => 'resolved', 'logged' => 'resolved'],
];

function isoTime(?string $time): ?string
{
    return $time ? (new DateTimeImmutable($time))->format(DATE_ATOM) : null;
}

function actionLabel(array $action, ?string $deviceName = null): string
{
    $target = SITUATION_ENTITIES[$action['target']] ?? ['label' => $action['target']];
    $label = $deviceName ?? $target['label'];

    if ($action['type'] === 'turn_on') {
        return "Turn on $label";
    }

    if ($action['type'] === 'turn_off') {
        return "Turn off $label";
    }

    return "Set $label";
}

function describeActions(array $actions, ?array $room, array $states): array
{
    return array_map(function (array $action, int $index) use ($room, $states): array {
        $target = SITUATION_ENTITIES[$action['target']] ?? [];
        $devices = [];
        $entityIds = $room['entities'][$action['target']] ?? [];

        if (isset($action['entity'])) {
            $entityIds = array_values(array_intersect($entityIds, [$action['entity']]));
        }

        foreach ($entityIds as $entityId) {
            $devices[] = isset($states[$entityId]) ? entityName($states[$entityId]) : $entityId;
        }

        return [
            'index'   => $index,
            'type'    => $action['type'],
            'label'   => actionLabel($action, isset($action['entity']) ? ($devices[0] ?? $action['entity']) : null),
            'devices' => $devices,
            'value'   => $action['value'] ?? null,
            'setting' => $action['type'] === 'set_value' ? ($target['settable'] ?? null) : null,
        ];
    }, $actions, array_keys($actions));
}

function situationOutput(array $row, array $rooms, array $states): array
{
    $evidence = json_decode($row['evidence'], true) ?: [];
    $parameters = json_decode($row['parameters'], true) ?: [];

    return [
        'id'           => (int) $row['id'],
        'name'         => $row['rule_name'],
        'room'         => $evidence['room_name'] ?? $row['area'],
        'area'         => $row['area'],
        'status'       => $row['status'],
        'complete'     => (bool) $row['is_complete'],
        'ongoing'      => !isset($evidence['ended_at']),
        'detectedAt'   => isoTime($row['detected_at']),
        'checkedAt'    => $evidence['checked_at'] ?? null,
        'endedAt'      => $evidence['ended_at'] ?? null,
        'observations' => array_map(fn(array $o): array => [
            'text'     => $o['text'] ?? '',
            'complete' => (bool) ($o['complete'] ?? true),
        ], $evidence['observations'] ?? []),
        'userActions'  => $evidence['user_actions'] ?? [],
        'handledBy'    => $row['handled_by_name'],
        'handledAt'    => isoTime($row['handled_at']),
        'actions'      => describeActions($parameters['actions'] ?? [], $rooms[$row['area']] ?? null, $states),
    ];
}

function logSituationEvent(PDO $pdo, string $ruleName, string $roomName, string $action): void
{
    $stmt = $pdo->prepare(
        "INSERT INTO event_history (event, user_id, data, status)
         VALUES ('situation_handled', :user_id, CAST(:data AS jsonb), 'succeeded')"
    );
    $stmt->execute([
        'user_id' => $_SESSION['user_id'],
        'data'    => json_encode(['rule_name' => $ruleName, 'room_name' => $roomName, 'action' => $action]),
    ]);
}

function chosenActions($chosen, array $ruleActions): array
{
    if (!is_array($chosen) || !array_is_list($chosen) || !$chosen) {
        sendError(400, 'Choose at least one action.');
    }

    $actions = [];

    foreach ($chosen as $choice) {
        $index = is_array($choice) ? ($choice['index'] ?? null) : null;

        if (!is_int($index) || !isset($ruleActions[$index]) || isset($actions[$index])) {
            sendError(400, 'One of the chosen actions does not exist anymore.');
        }

        $action = $ruleActions[$index];

        if ($action['type'] === 'set_value' && array_key_exists('value', $choice)) {
            $settable = SITUATION_ENTITIES[$action['target']]['settable'];
            $value = $choice['value'];

            $valid = isset($settable['options'])
                ? in_array($value, $settable['options'], true)
                : (is_int($value) || is_float($value)) && $value >= $settable['min'] && $value <= $settable['max']
                    && fmod($value - $settable['min'], $settable['step']) === 0.0;

            if (!$valid) {
                sendError(400, 'One of the chosen values is not allowed.');
            }

            $action['value'] = $value;
        }

        $actions[$index] = $action;
    }

    ksort($actions);

    return array_values($actions);
}

function connectSituationsDatabase(): PDO
{
    ob_start();
    require __DIR__ . '/../../connection.php';
    ob_end_clean();

    if (!isset($pdo)) {
        sendError(503, 'Could not connect to the database.');
    }

    return $pdo;
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'GET' && $method !== 'POST') {
    sendError(405, 'Method not allowed.');
}

if ($method === 'GET' && isset($_GET['count'])) {
    $pdo = connectSituationsDatabase();
    $count = (int) $pdo->query("SELECT COUNT(*) FROM situation WHERE status = 'active'")->fetchColumn();

    echo json_encode(['active' => $count]);
    exit;
}

if ($method === 'GET') {
    $pdo = connectSituationsDatabase();

    $stmt = $pdo->prepare(
        "SELECT s.id, s.area, s.status, s.is_complete, s.detected_at, s.evidence, s.handled_at,
                r.name AS rule_name, r.parameters, o.username AS handled_by_name
         FROM situation s
         JOIN situation_rule r ON r.id = s.rule_id
         LEFT JOIN occupant o ON o.id = s.handled_by
         WHERE s.status IN ('active', 'acknowledged')
            OR s.detected_at > NOW() - make_interval(days => :days)
         ORDER BY s.detected_at DESC, s.id DESC
         LIMIT :limit"
    );
    $stmt->bindValue('days', SITUATION_LIST_DAYS, PDO::PARAM_INT);
    $stmt->bindValue('limit', SITUATION_LIST_LIMIT, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll();

    $rooms = [];
    $states = [];
    $homeAssistant = true;

    if ($rows) {
        try {
            $rooms = situationRooms($config);
            $states = array_column(hassRequest($config, '/api/states'), null, 'entity_id');
        } catch (HassException $e) {
            $homeAssistant = false;
        }
    }

    echo json_encode([
        'situations'    => array_map(fn(array $row): array => situationOutput($row, $rooms, $states), $rows),
        'homeAssistant' => $homeAssistant,
    ]);
    exit;
}

if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
    sendError(415, 'Expected a JSON request.');
}

$input = json_decode(file_get_contents('php://input'), true);

if (!is_array($input)) {
    sendError(400, 'Invalid request.');
}

$situationId = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
$change = SITUATION_CHANGES[$input['action'] ?? ''] ?? null;

if ($situationId === false || $change === null) {
    sendError(400, 'Invalid request.');
}

$pdo = connectSituationsDatabase();

try {
    $pdo->beginTransaction();

    $stmt = $pdo->prepare(
        "SELECT s.id, s.area, s.status, s.evidence, r.name AS rule_name, r.parameters, o.username AS handled_by_name
         FROM situation s
         JOIN situation_rule r ON r.id = s.rule_id
         LEFT JOIN occupant o ON o.id = s.handled_by
         WHERE s.id = :id
         FOR UPDATE OF s"
    );
    $stmt->execute(['id' => $situationId]);
    $row = $stmt->fetch();

    if (!$row) {
        $pdo->rollBack();
        sendError(404, 'This situation no longer exists.');
    }

    $evidence = json_decode($row['evidence'], true) ?: [];
    $roomName = $evidence['room_name'] ?? $row['area'];

    if (!in_array($row['status'], $change['from'], true)) {
        $pdo->rollBack();
        sendError(409, 'This situation was already ' . $row['status']
            . ($row['handled_by_name'] ? " by {$row['handled_by_name']}" : '') . '. The list has been refreshed.');
    }

    if (isset($evidence['ended_at']) && ($input['action'] === 'restore' || $input['action'] === 'run')) {
        $pdo->rollBack();
        sendError(409, 'This situation has already ended. The list has been refreshed.');
    }

    $message = null;

    if ($input['action'] === 'run') {
        $parameters = json_decode($row['parameters'], true) ?: [];
        $actions = chosenActions($input['actions'] ?? null, $parameters['actions'] ?? []);

        $rooms = situationRooms($config);
        $room = $rooms[$row['area']] ?? null;

        if ($room === null) {
            $pdo->rollBack();
            sendError(409, 'This room is no longer available in Home Assistant.');
        }

        $states = array_column(hassRequest($config, '/api/states'), null, 'entity_id');
        $results = runActions($pdo, $config, $actions, $room, $states, $row['rule_name'], (int) $_SESSION['user_id']);

        $stmt = $pdo->prepare('UPDATE situation SET evidence = evidence || CAST(:actions AS jsonb) WHERE id = :id');
        $stmt->execute([
            'actions' => json_encode(['user_actions' => $results, 'user_actions_at' => date(DATE_ATOM)]),
            'id'      => $situationId,
        ]);

        $failed = count(array_filter($results, fn(array $result): bool => !$result['ok']));

        if (!$results || $failed > 0) {
            $pdo->commit();

            $message = !$results
                ? 'There are no devices in this room for the chosen actions.'
                : "$failed of " . count($results) . ' device commands did not work. The situation is still open.';

            http_response_code(502);
            echo json_encode(['error' => $message, 'results' => $results]);
            exit;
        }

        $message = count($results) === 1 ? '1 device command ran.' : count($results) . ' device commands ran.';
    }

    $stmt = $pdo->prepare(
        'UPDATE situation
         SET status = :status, handled_by = :user_id, handled_at = NOW()
         WHERE id = :id'
    );
    $stmt->bindValue('status', $change['to']);
    $stmt->bindValue('user_id', $change['to'] === 'active' ? null : $_SESSION['user_id'], $change['to'] === 'active' ? PDO::PARAM_NULL : PDO::PARAM_INT);
    $stmt->bindValue('id', $situationId, PDO::PARAM_INT);
    $stmt->execute();

    if ($change['logged'] !== null) {
        logSituationEvent($pdo, $row['rule_name'], $roomName, $change['logged']);
    }

    $pdo->commit();
} catch (PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    error_log('Updating situation failed: ' . $e->getMessage());
    sendError(500, 'Could not save your decision. Please try again.');
}

echo json_encode(['ok' => true, 'status' => $change['to'], 'message' => $message]);
