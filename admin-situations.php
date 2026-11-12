<?php
require __DIR__ . '/hass.php';
require_once __DIR__ . '/situation-catalog.php';

const RULE_NAME_MAX_LENGTH = 80;
const RULE_MAX_ROWS = 10;
const RULE_MAX_DURATION = 1440;
const TIME_PATTERN = '/^([01]\d|2[0-3]):[0-5]\d$/';

function sendFieldErrors(array $errors): void
{
    http_response_code(422);
    echo json_encode(['error' => 'Please fix the highlighted fields.', 'fields' => (object) $errors]);
    exit;
}

function isNumber($value): bool
{
    return (is_int($value) || is_float($value)) && is_finite($value);
}

function validateCondition($condition): array
{
    if (!is_array($condition)) {
        return [null, 'Every condition needs a sensor or device.'];
    }

    $key = $condition['entity'] ?? '';
    $entity = is_string($key) ? (SITUATION_ENTITIES[$key] ?? null) : null;

    if ($entity === null) {
        return [null, 'Every condition needs a sensor or device.'];
    }

    $operator = $condition['operator'] ?? '';

    if (!in_array($operator, SITUATION_OPERATORS[$entity['kind']], true)) {
        return [null, "Choose how to compare \"{$entity['label']}\"."];
    }

    $value = $condition['value'] ?? null;

    if ($entity['kind'] === 'state' && !in_array($value, $entity['states'], true)) {
        return [null, "Choose a state for \"{$entity['label']}\"."];
    }

    if ($entity['kind'] === 'number' && !isNumber($value)) {
        return [null, 'Enter a value for every numeric condition.'];
    }

    if ($entity['kind'] === 'time') {
        $from = is_array($value) ? ($value['from'] ?? '') : '';
        $to = is_array($value) ? ($value['to'] ?? '') : '';

        if (!is_string($from) || !is_string($to)
            || !preg_match(TIME_PATTERN, $from) || !preg_match(TIME_PATTERN, $to)) {
            return [null, 'Enter a start and end time for every time condition.'];
        }

        if ($from === $to) {
            return [null, 'The start and end time must be different.'];
        }

        $value = ['from' => $from, 'to' => $to];
    }

    $duration = $condition['duration'] ?? null;

    if ($duration === 0) {
        $duration = null;
    }

    if ($duration !== null && ($entity['kind'] === 'time' || !is_int($duration)
        || $duration < 1 || $duration > RULE_MAX_DURATION)) {
        return [null, 'Duration must be a whole number of minutes, up to ' . RULE_MAX_DURATION . '.'];
    }

    return [[
        'entity'   => $key,
        'operator' => $operator,
        'value'    => $entity['kind'] === 'number' ? (float) $value : $value,
        'duration' => $duration,
    ], null];
}

function validateAction($action): array
{
    if (!is_array($action) || !in_array($action['type'] ?? '', SITUATION_ACTIONS, true)) {
        return [null, 'Choose what every action does.'];
    }

    $type = $action['type'];
    $key = $action['target'] ?? '';
    $target = is_string($key) ? (SITUATION_ENTITIES[$key] ?? null) : null;
    $entity = $action['entity'] ?? null;

    if ($entity !== null && (!is_string($entity) || !preg_match('/^[a-z_]+\.[a-z0-9_]+$/', $entity))) {
        return [null, 'One of the chosen devices is not valid.'];
    }

    $only = $entity === null ? [] : ['entity' => $entity];

    if ($type === 'set_value') {
        $settable = $target['settable'] ?? null;

        if ($settable === null) {
            return [null, 'Choose a device for every action.'];
        }

        $value = $action['value'] ?? null;

        if (isset($settable['options'])) {
            if (!in_array($value, $settable['options'], true)) {
                return [null, "Choose a {$settable['name']} for \"{$target['label']}\"."];
            }
        } elseif (!isNumber($value) || $value < $settable['min'] || $value > $settable['max']
            || fmod($value - $settable['min'], $settable['step']) !== 0.0) {
            return [null, "{$target['label']} {$settable['name']} must be between "
                . "{$settable['min']} and {$settable['max']} {$settable['unit']}"
                . ($settable['step'] < 1 ? ", in steps of {$settable['step']}." : '.')];
        }

        return [['type' => $type, 'target' => $key, 'value' => $value] + $only, null];
    }

    if (empty($target['device'])) {
        return [null, 'Choose a device for every action.'];
    }

    return [['type' => $type, 'target' => $key] + $only, null];
}

function validateRows($rows, string $what, callable $validate, bool $optional = false): array
{
    if (!is_array($rows) || !array_is_list($rows) || (!$rows && !$optional)) {
        return [[], "Add at least one $what."];
    }

    if (count($rows) > RULE_MAX_ROWS) {
        return [[], 'You can add at most ' . RULE_MAX_ROWS . " {$what}s."];
    }

    $valid = [];

    foreach ($rows as $row) {
        [$clean, $error] = $validate($row);

        if ($error !== null) {
            return [[], $error];
        }

        $valid[] = $clean;
    }

    return [$valid, null];
}

function validateRule(array $input, array $rooms): array
{
    $errors = [];

    $name = trim((string) ($input['name'] ?? ''));

    if ($name === '') {
        $errors['name'] = 'Please enter a name.';
    } elseif (mb_strlen($name) > RULE_NAME_MAX_LENGTH) {
        $errors['name'] = 'The name can be at most ' . RULE_NAME_MAX_LENGTH . ' characters.';
    }

    [$conditions, $error] = validateRows($input['conditions'] ?? null, 'condition', 'validateCondition');

    if ($error !== null) {
        $errors['conditions'] = $error;
    }

    [$actions, $error] = validateRows($input['actions'] ?? [], 'action', 'validateAction', true);

    if ($error !== null) {
        $errors['actions'] = $error;
    }

    $roomIds = $input['rooms'] ?? null;

    if (!is_array($roomIds) || !array_is_list($roomIds) || !$roomIds) {
        $errors['rooms'] = 'Select at least one room.';
    } else {
        $roomIds = array_values(array_unique(array_filter($roomIds, 'is_string')));

        $required = array_unique(array_merge(
            array_column(array_filter($conditions, fn($c) => empty(SITUATION_ENTITIES[$c['entity']]['global'])), 'entity'),
            array_column($actions, 'target')
        ));

        foreach ($roomIds as $roomId) {
            if (!isset($rooms[$roomId])) {
                $errors['rooms'] = 'One of the selected rooms no longer exists.';
                break;
            }

            $missing = array_diff($required, array_keys($rooms[$roomId]['entities']));

            if ($missing) {
                $labels = array_map(fn($key) => strtolower(SITUATION_ENTITIES[$key]['label']), $missing);
                $errors['rooms'] = "{$rooms[$roomId]['name']} has no " . implode(', ', $labels) . '.';
                break;
            }
        }

        foreach ($actions as $action) {
            if (!isset($action['entity']) || isset($errors['rooms'])) {
                continue;
            }

            if (count($roomIds) !== 1) {
                $errors['actions'] = 'A specific device can only be chosen when the situation applies to one room.';
                break;
            }

            if (!in_array($action['entity'], $rooms[$roomIds[0]]['entities'][$action['target']] ?? [], true)) {
                $errors['actions'] = 'One of the chosen devices is not in ' . $rooms[$roomIds[0]]['name'] . '.';
                break;
            }
        }
    }

    if ($errors) {
        sendFieldErrors($errors);
    }

    return [
        'name'       => $name,
        'parameters' => [
            'rooms'      => $roomIds,
            'conditions' => $conditions,
            'actions'    => $actions,
        ],
    ];
}

function roomActionDevices(array $room): object
{
    $devices = [];

    foreach ($room['entities'] as $key => $entityIds) {
        $definition = SITUATION_ENTITIES[$key] ?? [];

        if (empty($definition['device']) && empty($definition['settable'])) {
            continue;
        }

        $devices[$key] = array_map(fn(string $id): array => [
            'id'   => $id,
            'name' => $room['names'][$id] ?? $id,
        ], $entityIds);
    }

    return (object) $devices;
}

function ruleOutput(array $row): array
{
    $parameters = json_decode($row['parameters'], true) ?: [];

    return [
        'id'            => (int) $row['id'],
        'name'          => $row['name'],
        'rooms'         => $parameters['rooms'] ?? [],
        'conditions'    => $parameters['conditions'] ?? [],
        'actions'       => $parameters['actions'] ?? [],
        'enabled'       => (bool) $row['is_enabled'],
        'lastTriggered' => $row['last_triggered']
            ? (new DateTimeImmutable($row['last_triggered']))->format(DATE_ATOM)
            : null,
    ];
}

function findRule(PDO $pdo, int $id, bool $lock = false): ?array
{
    $stmt = $pdo->prepare(
        'SELECT r.id, r.name, r.parameters, r.is_enabled,
                (SELECT MAX(s.detected_at) FROM situation s WHERE s.rule_id = r.id) AS last_triggered
         FROM situation_rule r
         WHERE r.id = :id'
        . ($lock ? ' FOR UPDATE OF r' : '')
    );
    $stmt->execute(['id' => $id]);

    return $stmt->fetch() ?: null;
}

function nameTaken(PDO $pdo, string $name, ?int $exceptId): bool
{
    $stmt = $pdo->prepare(
        'SELECT 1 FROM situation_rule WHERE LOWER(name) = LOWER(:name) AND id <> :id'
    );
    $stmt->execute(['name' => $name, 'id' => $exceptId ?? 0]);

    return (bool) $stmt->fetchColumn();
}

if (!isAdmin()) {
    sendError(403, 'Only admins can manage smart situations.');
}

$method = $_SERVER['REQUEST_METHOD'];

if (!in_array($method, ['GET', 'POST', 'PATCH', 'DELETE'], true)) {
    sendError(405, 'Method not allowed.');
}

$input = [];

if ($method !== 'GET') {
    if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
        sendError(415, 'Expected a JSON request.');
    }

    $input = json_decode(file_get_contents('php://input'), true);

    if (!is_array($input)) {
        sendError(400, 'Invalid request.');
    }
}

$ruleId = null;

if ($method === 'PATCH' || $method === 'DELETE' || isset($input['id'])) {
    $ruleId = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

    if ($ruleId === false) {
        sendError(400, 'Invalid situation.');
    }
}

$rooms = $method === 'GET' || $method === 'POST' ? situationRooms($config) : [];
$rule = $method === 'POST' ? validateRule($input, $rooms) : null;

if ($method === 'PATCH' && !is_bool($input['enabled'] ?? null)) {
    sendError(400, 'Invalid request.');
}

ob_start();
require __DIR__ . '/../../connection.php';
ob_end_clean();

if (!isset($pdo)) {
    sendError(503, 'Could not connect to the database.');
}

if ($method === 'GET') {
    $rows = $pdo->query(
        'SELECT r.id, r.name, r.parameters, r.is_enabled,
                (SELECT MAX(s.detected_at) FROM situation s WHERE s.rule_id = r.id) AS last_triggered
         FROM situation_rule r
         ORDER BY r.id'
    )->fetchAll();

    echo json_encode([
        'entities' => SITUATION_ENTITIES,
        'rooms'    => array_values(array_map(fn($room) => [
            'id'       => $room['id'],
            'name'     => $room['name'],
            'entities' => array_keys($room['entities']),
            'devices'  => roomActionDevices($room),
        ], $rooms)),
        'rules'    => array_map('ruleOutput', $rows),
    ]);
    exit;
}

try {
    $pdo->beginTransaction();

    $current = $ruleId === null ? null : findRule($pdo, $ruleId, true);

    if ($ruleId !== null && !$current) {
        $pdo->rollBack();
        sendError(404, 'This situation no longer exists.');
    }

    if ($method === 'DELETE') {
        $stmt = $pdo->prepare('DELETE FROM situation WHERE rule_id = :id');
        $stmt->execute(['id' => $ruleId]);

        $stmt = $pdo->prepare('DELETE FROM situation_rule WHERE id = :id');
        $stmt->execute(['id' => $ruleId]);

        $pdo->commit();

        echo json_encode(['deleted' => $ruleId]);
        exit;
    }

    if ($method === 'PATCH') {
        if ((bool) $current['is_enabled'] !== $input['enabled']) {
            $stmt = $pdo->prepare(
                'UPDATE situation_rule SET is_enabled = :enabled, updated_at = NOW() WHERE id = :id'
            );
            $stmt->bindValue('enabled', $input['enabled'], PDO::PARAM_BOOL);
            $stmt->bindValue('id', $ruleId, PDO::PARAM_INT);
            $stmt->execute();
        }

        $pdo->commit();

        echo json_encode(['rule' => ruleOutput(findRule($pdo, $ruleId))]);
        exit;
    }

    if (nameTaken($pdo, $rule['name'], $ruleId)) {
        $pdo->rollBack();
        sendFieldErrors(['name' => 'A situation with this name already exists.']);
    }

    if ($ruleId === null) {
        $stmt = $pdo->prepare(
            "INSERT INTO situation_rule (name, type, parameters, created_by)
             VALUES (:name, 'custom', CAST(:parameters AS jsonb), :admin_id)
             RETURNING id"
        );
        $stmt->execute([
            'name'       => $rule['name'],
            'parameters' => json_encode($rule['parameters']),
            'admin_id'   => $_SESSION['user_id'],
        ]);

        $ruleId = (int) $stmt->fetchColumn();
    } else {
        $stmt = $pdo->prepare(
            'UPDATE situation_rule
             SET name = :name, parameters = CAST(:parameters AS jsonb), updated_at = NOW()
             WHERE id = :id'
        );
        $stmt->execute([
            'name'       => $rule['name'],
            'parameters' => json_encode($rule['parameters']),
            'id'         => $ruleId,
        ]);
    }

    $pdo->commit();
} catch (PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    error_log('Saving smart situation failed: ' . $e->getMessage());
    sendError(500, $method === 'DELETE'
        ? 'Could not delete the situation. Please try again.'
        : 'Could not save the situation. Please try again.');
}

echo json_encode(['rule' => ruleOutput(findRule($pdo, $ruleId))]);
