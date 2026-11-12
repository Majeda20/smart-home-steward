<?php
const HISTORY_PAGE_SIZE = 10;
const HISTORY_SEARCH_MAX_LENGTH = 100;
const HISTORY_MAX_OFFSET = 10000;

const HISTORY_TYPES = [
    'device'      => ['device_control'],
    'situations'  => ['situation_handled'],
    'users'       => ['user_updated', 'user_deleted'],
];

const HISTORY_PERIODS = [
    'today' => 'today',
    '24h'   => '-24 hours',
    '7d'    => '-7 days',
    '30d'   => '-30 days',
    'all'   => null,
];

const DEVICE_SUFFIXES = [
    'light'   => 'light',
    'climate' => 'thermostat',
    'fan'     => 'fan',
];

const EVENT_PHRASES = [
    'situation_handled' => 'situation',
    'user_updated'      => 'updated account',
    'user_deleted'      => 'deleted account',
];

const DEVICE_VERBS = [
    'turn_on'     => 'turned on',
    'turn_off'    => 'turned off',
    'toggle'      => 'switched',
    'open_cover'  => 'opened',
    'close_cover' => 'closed',
    'stop_cover'  => 'stopped',
];

function sendError(int $status, string $message): void
{
    http_response_code($status);
    echo json_encode(['error' => $message]);
    exit;
}

function eventType(string $event): string
{
    foreach (HISTORY_TYPES as $type => $events) {
        if (in_array($event, $events, true)) {
            return $type;
        }
    }

    return 'other';
}

function keyword(string $text, string $kind): array
{
    return ['text' => $text, 'kind' => $kind];
}

function startsWord(string $text, string $query): bool
{
    return (bool) preg_match('/(?<![\p{L}\p{N}])' . preg_quote($query, '/') . '/iu', $text);
}

function humanize(string $text): string
{
    $words = array_map(
        fn(string $word): string => strlen($word) <= 2 ? strtoupper($word) : $word,
        explode(' ', str_replace('_', ' ', $text))
    );

    return ucfirst(implode(' ', $words));
}

function deviceName(?string $entityId, array $data): string
{
    if (!empty($data['device_name'])) {
        return $data['device_name'];
    }

    if (!$entityId) {
        return 'a device';
    }

    [$domain, $id] = array_pad(explode('.', $entityId, 2), 2, $entityId);
    $name = humanize($id);
    $suffix = DEVICE_SUFFIXES[$domain] ?? null;

    if ($suffix && stripos($name, $suffix) === false) {
        $name .= ' ' . $suffix;
    }

    return $name;
}

function describeDeviceControl(array $user, array $row, array $data): array
{
    $service = $data['service'] ?? '';
    $device = keyword(deviceName($row['entity_id'] ?? null, $data), 'device');

    if ($service === 'set_temperature' && isset($data['temperature'])) {
        $temperature = keyword($data['temperature'] . ' °C', 'value');
        $temperature['quantity'] = ['value' => (float) $data['temperature'], 'unit' => 'celsius'];

        return [$user, ['text' => ' set '], $device, ['text' => ' to '], $temperature];
    }

    if ($service === 'set_hvac_mode' && isset($data['hvac_mode'])) {
        if ($data['hvac_mode'] === 'off') {
            return [$user, ['text' => ' '], keyword('turned off', 'action'), ['text' => ' '], $device];
        }

        return [$user, ['text' => ' set '], $device, ['text' => ' to '], keyword(humanize($data['hvac_mode']) . ' mode', 'value')];
    }

    if ($service === 'select_option' && isset($data['option'])) {
        return [$user, ['text' => ' set '], $device, ['text' => ' to '], keyword(humanize($data['option']), 'value')];
    }

    if ($service === 'turn_on' && isset($data['brightness_pct'])) {
        return [$user, ['text' => ' set '], $device, ['text' => ' to '], keyword($data['brightness_pct'] . '%', 'value')];
    }

    if ($service === 'set_cover_position' && isset($data['position'])) {
        return [$user, ['text' => ' set '], $device, ['text' => ' to '], keyword($data['position'] . '%', 'value')];
    }

    if (isset(DEVICE_VERBS[$service])) {
        return [$user, ['text' => ' '], keyword(DEVICE_VERBS[$service], 'action'), ['text' => ' '], $device];
    }

    return [$user, ['text' => ' controlled '], $device];
}

function describeUserUpdate(array $user, array $data): array
{
    $target = keyword($data['target_username'] ?? 'unknown', 'user');
    $changes = is_array($data['changes'] ?? null) ? $data['changes'] : [];
    $parts = [$user, ['text' => ' updated account '], $target];
    $first = true;

    foreach (['username', 'email', 'role'] as $field) {
        if (!isset($changes[$field]['from'], $changes[$field]['to'])) {
            continue;
        }

        $from = $field === 'role' ? ucfirst($changes[$field]['from']) : $changes[$field]['from'];
        $to = $field === 'role' ? ucfirst($changes[$field]['to']) : $changes[$field]['to'];

        array_push(
            $parts,
            ['text' => ($first ? ' (' : ', ') . "$field: "],
            keyword($from, 'value'),
            ['text' => ' → '],
            keyword($to, 'value')
        );
        $first = false;
    }

    if (!$first) {
        $parts[] = ['text' => ')'];
    }

    return $parts;
}

function describeEvent(array $row): array
{
    $data = json_decode($row['data'] ?? '', true);
    $data = is_array($data) ? $data : [];
    $user = keyword($row['username'] ?? $data['actor_username'] ?? 'System', 'user');

    if ($row['username'] === null && isset($data['actor_username'])) {
        $user['note'] = ' (deleted)';
    }

    switch ($row['event']) {
        case 'device_control':
            return describeDeviceControl($user, $row, $data);
        case 'situation_handled':
            return [
                $user,
                ['text' => ' '],
                keyword($data['action'] ?? 'handled', 'action'),
                ['text' => ' situation '],
                keyword($data['rule_name'] ?? 'unknown', 'rule'),
            ];
        case 'user_updated':
            return describeUserUpdate($user, $data);
        case 'user_deleted':
            if (!empty($data['self'])) {
                return [$user, ['text' => ' deleted their account']];
            }

            return [
                $user,
                ['text' => ' deleted account '],
                keyword($data['target_username'] ?? 'unknown', 'user'),
            ];
        default:
            return [$user, ['text' => ': '], keyword($row['event'], 'action')];
    }
}

function withoutActor(array $parts): array
{
    array_shift($parts);

    $parts[0]['text'] = ltrim($parts[0]['text']);

    if ($parts[0]['text'] === '') {
        array_shift($parts);
    }

    $parts[0]['text'] = ucfirst($parts[0]['text']);

    return $parts;
}

function respondWithHistory(array $allowedTypes, string $scopeSql = '', array $scopeParams = [], bool $showActor = true): void
{
    $query = trim((string) ($_GET['q'] ?? ''));
    $type = (string) ($_GET['type'] ?? '');
    $period = (string) ($_GET['period'] ?? '7d');
    $offset = filter_var($_GET['offset'] ?? 0, FILTER_VALIDATE_INT, [
        'options' => ['min_range' => 0, 'max_range' => HISTORY_MAX_OFFSET],
    ]);

    if (mb_strlen($query) > HISTORY_SEARCH_MAX_LENGTH) {
        sendError(400, 'Search text is too long.');
    }

    if ($type !== '' && !in_array($type, $allowedTypes, true)) {
        sendError(400, 'Unknown activity type.');
    }

    if (!array_key_exists($period, HISTORY_PERIODS)) {
        sendError(400, 'Unknown time period.');
    }

    if ($offset === false) {
        sendError(400, 'Invalid offset.');
    }

    $configPath = require __DIR__ . '/../../config-path.php';

    if (!is_readable($configPath)) {
        error_log('Database config not found at: ' . $configPath);
        sendError(500, 'The database is not configured.');
    }

    ob_start();
    require __DIR__ . '/../../connection.php';
    ob_end_clean();

    if (!isset($pdo)) {
        sendError(503, 'Could not connect to the database.');
    }

    $params = $scopeParams;
    $allowedPlaceholders = [];

    foreach (array_merge(...array_map(fn(string $allowed): array => HISTORY_TYPES[$allowed], $allowedTypes)) as $index => $event) {
        $allowedPlaceholders[] = ":allowed$index";
        $params["allowed$index"] = $event;
    }

    $where = [
        'eh.event IN (' . implode(', ', $allowedPlaceholders) . ')',
        "eh.data->>'action' IS DISTINCT FROM 'restored'",
        "(eh.event <> 'user_updated' OR eh.data->>'self' IS DISTINCT FROM 'true')",
    ];

    if ($scopeSql !== '') {
        $where[] = $scopeSql;
    }

    if ($type !== '') {
        $placeholders = [];

        foreach (HISTORY_TYPES[$type] as $index => $event) {
            $placeholders[] = ":event$index";
            $params["event$index"] = $event;
        }

        $where[] = 'eh.event IN (' . implode(', ', $placeholders) . ')';
    }

    if (HISTORY_PERIODS[$period] !== null) {
        $where[] = 'eh.time >= :since';
        $params['since'] = (new DateTimeImmutable(HISTORY_PERIODS[$period]))->format(DATE_ATOM);
    }

    if ($query !== '') {
        $pattern = '%' . addcslashes($query, '%_\\') . '%';
        $searchColumns = [
            'o.username',
            "eh.data->>'action'",
            "eh.data->>'rule_name'",
            "eh.data->>'target_username'",
            "eh.data->>'actor_username'",
            "eh.data->>'device_name'",
            "eh.data#>>'{changes,username,from}'",
            "eh.data#>>'{changes,email,from}'",
            "eh.data#>>'{changes,email,to}'",
        ];
        $conditions = [];

        foreach ($searchColumns as $index => $column) {
            $conditions[] = "$column ILIKE :search$index";
            $params["search$index"] = $pattern;
        }

        $deviceConditions = [];

        foreach (preg_split('/\s+/', $query) as $index => $word) {
            $deviceConditions[] = "eh.entity_id ILIKE :device$index";
            $params["device$index"] = '%' . addcslashes($word, '%_\\') . '%';
        }

        $conditions[] = '(' . implode(' AND ', $deviceConditions) . ')';

        $matchingServices = array_keys(array_filter(
            DEVICE_VERBS + ['set_temperature' => 'set', 'set_hvac_mode' => 'set', 'set_cover_position' => 'set'],
            fn(string $label): bool => startsWord($label, $query)
        ));

        if ($matchingServices) {
            $servicePlaceholders = [];

            foreach ($matchingServices as $index => $service) {
                $servicePlaceholders[] = ":service$index";
                $params["service$index"] = $service;
            }

            $conditions[] = "eh.data->>'service' IN (" . implode(', ', $servicePlaceholders) . ')';
        }

        $matchingEvents = array_keys(array_filter(
            EVENT_PHRASES,
            fn(string $phrase): bool => startsWord($phrase, $query)
        ));

        if ($matchingEvents) {
            $eventPlaceholders = [];

            foreach ($matchingEvents as $index => $event) {
                $eventPlaceholders[] = ":phrase$index";
                $params["phrase$index"] = $event;
            }

            $conditions[] = 'eh.event IN (' . implode(', ', $eventPlaceholders) . ')';
        }

        $where[] = '(' . implode(' OR ', $conditions) . ')';
    }

    $from = ' FROM event_history eh
            LEFT JOIN occupant o ON o.id = eh.user_id
            WHERE ' . implode(' AND ', $where);

    $sql = 'SELECT eh.id, eh.event, eh.time, eh.data, eh.entity_id, eh.status, o.username'
        . $from
        . ' ORDER BY eh.time DESC, eh.id DESC
            LIMIT :limit OFFSET :offset';

    try {
        $stmt = $pdo->prepare($sql);

        foreach ($params as $name => $value) {
            $stmt->bindValue($name, $value);
        }

        $stmt->bindValue('limit', HISTORY_PAGE_SIZE + 1, PDO::PARAM_INT);
        $stmt->bindValue('offset', $offset, PDO::PARAM_INT);
        $stmt->execute();

        $rows = $stmt->fetchAll();

        $countStmt = $pdo->prepare('SELECT COUNT(*)' . $from);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();
    } catch (PDOException $e) {
        error_log('Loading activity history failed: ' . $e->getMessage());
        sendError(500, 'Could not load activity history.');
    }

    $hasMore = count($rows) > HISTORY_PAGE_SIZE;
    $rows = array_slice($rows, 0, HISTORY_PAGE_SIZE);

    $events = array_map(function (array $row) use ($showActor): array {
        $parts = describeEvent($row);

        if (!$showActor) {
            $parts = withoutActor($parts);
        }

        return [
            'id'          => (int) $row['id'],
            'type'        => eventType($row['event']),
            'description' => implode('', array_map(fn(array $part): string => $part['text'] . ($part['note'] ?? ''), $parts)),
            'parts'       => $parts,
            'time'        => (new DateTimeImmutable($row['time']))->format(DATE_ATOM),
            'status'      => $row['status'],
        ];
    }, $rows);

    echo json_encode(['events' => $events, 'hasMore' => $hasMore, 'total' => $total]);
}
