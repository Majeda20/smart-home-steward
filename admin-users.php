<?php
require __DIR__ . '/../../session.php';

header('Content-Type: application/json');

const USERNAME_PATTERN = '/^[A-Za-z0-9_.-]{3,50}$/';
const EMAIL_MAX_LENGTH = 255;

function sendError(int $status, string $message, array $fieldErrors = []): void
{
    http_response_code($status);
    echo json_encode(['error' => $message, 'fields' => (object) $fieldErrors]);
    exit;
}

function failAndRollBack(PDO $pdo, int $status, string $message, array $fieldErrors = []): void
{
    $pdo->rollBack();
    sendError($status, $message, $fieldErrors);
}

function findUser(PDO $pdo, int $id, bool $lock = false): ?array
{
    $stmt = $pdo->prepare(
        'SELECT o.id, o.username, o.email, ut.type AS role
         FROM occupant o
         JOIN user_type ut ON ut.id = o.user_type_id
         WHERE o.id = :id'
        . ($lock ? ' FOR UPDATE OF o' : '')
    );
    $stmt->execute(['id' => $id]);

    return $stmt->fetch() ?: null;
}

function logUserEvent(PDO $pdo, string $event, array $data): void
{
    $stmt = $pdo->prepare(
        "INSERT INTO event_history (event, user_id, data, status)
         VALUES (:event, :admin_id, CAST(:data AS jsonb), 'succeeded')"
    );
    $stmt->execute([
        'event'    => $event,
        'admin_id' => $_SESSION['user_id'],
        'data'     => json_encode($data),
    ]);
}

if (!isLoggedIn()) {
    sendError(401, 'Not logged in.');
}

if (!isAdmin()) {
    sendError(403, 'Only admins can manage users.');
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'POST' && $method !== 'DELETE') {
    sendError(405, 'Method not allowed.');
}

if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
    sendError(415, 'Expected a JSON request.');
}

$input = json_decode(file_get_contents('php://input'), true);

if (!is_array($input)) {
    sendError(400, 'Invalid request.');
}

$userId = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

if ($userId === false) {
    sendError(400, 'Invalid user.');
}

$errors = [];

if ($method === 'POST') {
    $username = trim((string) ($input['username'] ?? ''));
    $email = strtolower(trim((string) ($input['email'] ?? '')));
    $role = strtolower(trim((string) ($input['role'] ?? '')));

    if ($username === '') {
        $errors['username'] = 'Username is required.';
    } elseif (!preg_match(USERNAME_PATTERN, $username)) {
        $errors['username'] = 'Username must be 3-50 characters: letters, numbers, ".", "_" or "-".';
    }

    if ($email === '') {
        $errors['email'] = 'Email is required.';
    } elseif (strlen($email) > EMAIL_MAX_LENGTH || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $errors['email'] = 'Please enter a valid email address.';
    }

    if ($role === '') {
        $errors['role'] = 'Role is required.';
    }

    if ($errors) {
        sendError(422, 'Please fix the highlighted fields.', $errors);
    }
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

$isSelf = (int) $userId === (int) $_SESSION['user_id'];

try {
    $pdo->beginTransaction();

    $current = findUser($pdo, $userId, true);

    if (!$current) {
        failAndRollBack($pdo, 404, 'This user no longer exists.');
    }

    $actor = findUser($pdo, (int) $_SESSION['user_id']);

    if (!$actor || strtolower($actor['role']) !== 'admin') {
        failAndRollBack($pdo, 403, 'Only admins can manage users.');
    }

    $targetIsAdmin = strtolower($current['role']) === 'admin';

    if ($method === 'DELETE') {
        if ($isSelf) {
            failAndRollBack($pdo, 403, 'You cannot delete your own account.');
        }

        $stmt = $pdo->prepare(
            "UPDATE event_history
             SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object('actor_username', CAST(:username AS text))
             WHERE user_id = :id"
        );
        $stmt->execute(['username' => $current['username'], 'id' => $userId]);

        logUserEvent($pdo, 'user_deleted', [
            'target_username' => $current['username'],
            'target_role'     => strtolower($current['role']),
        ]);

        $stmt = $pdo->prepare('DELETE FROM occupant WHERE id = :id');
        $stmt->execute(['id' => $userId]);

        $pdo->commit();

        echo json_encode(['deleted' => ['id' => (int) $userId, 'username' => $current['username']]]);
        exit;
    }

    $stmt = $pdo->prepare('SELECT id FROM user_type WHERE type = :role');
    $stmt->execute(['role' => $role]);
    $roleId = $stmt->fetchColumn();

    if ($roleId === false) {
        failAndRollBack($pdo, 422, 'Please fix the highlighted fields.', ['role' => 'Unknown role.']);
    }

    if ($isSelf && $role !== strtolower($current['role'])) {
        failAndRollBack($pdo, 422, 'Please fix the highlighted fields.', ['role' => 'You cannot change your own role.']);
    }

    if ($targetIsAdmin && $role !== 'admin') {
        $admins = (int) $pdo->query(
            "SELECT COUNT(*) FROM occupant o JOIN user_type ut ON ut.id = o.user_type_id WHERE ut.type = 'admin'"
        )->fetchColumn();

        if ($admins <= 1) {
            failAndRollBack($pdo, 422, 'Please fix the highlighted fields.', ['role' => 'There must be at least one admin.']);
        }
    }

    $stmt = $pdo->prepare(
        'SELECT username, email FROM occupant
         WHERE id <> :id AND (LOWER(email) = :email OR LOWER(username) = LOWER(:username))'
    );
    $stmt->execute(['id' => $userId, 'email' => $email, 'username' => $username]);

    foreach ($stmt->fetchAll() as $existing) {
        if (strtolower($existing['email']) === $email) {
            $errors['email'] = 'An account with this email already exists.';
        }
        if (strcasecmp($existing['username'], $username) === 0) {
            $errors['username'] = 'This username is already taken.';
        }
    }

    if ($errors) {
        failAndRollBack($pdo, 422, 'Please fix the highlighted fields.', $errors);
    }

    $changes = [];

    if ($current['username'] !== $username) {
        $changes['username'] = ['from' => $current['username'], 'to' => $username];
    }
    if ($current['email'] !== $email) {
        $changes['email'] = ['from' => $current['email'], 'to' => $email];
    }
    if (strtolower($current['role']) !== $role) {
        $changes['role'] = ['from' => strtolower($current['role']), 'to' => $role];
    }

    if ($changes) {
        $stmt = $pdo->prepare(
            'UPDATE occupant SET username = :username, email = :email, user_type_id = :role_id WHERE id = :id'
        );
        $stmt->execute([
            'username' => $username,
            'email'    => $email,
            'role_id'  => $roleId,
            'id'       => $userId,
        ]);

        if (!$isSelf) {
            logUserEvent($pdo, 'user_updated', ['target_username' => $username, 'changes' => $changes]);
        }
    }

    $pdo->commit();
} catch (PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    if ($e->getCode() === '23505') {
        sendError(409, 'An account with this email or username already exists.');
    }

    error_log(($method === 'DELETE' ? 'Deleting' : 'Updating') . ' user failed: ' . $e->getMessage());
    sendError(500, $method === 'DELETE'
        ? 'Could not delete the user. Please try again.'
        : 'Could not save the changes. Please try again.');
}

if ($isSelf) {
    $_SESSION['username'] = $username;
}

echo json_encode([
    'user'    => ['id' => (int) $userId, 'username' => $username, 'email' => $email, 'role' => $role],
    'changed' => (bool) $changes,
]);
