<?php
require __DIR__ . '/../../session.php';

header('Content-Type: application/json');

const USERNAME_PATTERN = '/^[A-Za-z0-9_.-]{3,50}$/';
const EMAIL_MAX_LENGTH = 255;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72;

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

if (!isLoggedIn()) {
    sendError(401, 'Not logged in.');
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

$currentPassword = (string) ($input['current_password'] ?? '');
$errors = [];

if ($currentPassword === '') {
    $errors['current_password'] = 'Enter your current password to confirm.';
}

if ($method === 'POST') {
    $username = trim((string) ($input['username'] ?? ''));
    $email = strtolower(trim((string) ($input['email'] ?? '')));
    $newPassword = (string) ($input['new_password'] ?? '');
    $confirmPassword = (string) ($input['confirm_password'] ?? '');

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

    if ($newPassword !== '' || $confirmPassword !== '') {
        if (strlen($newPassword) < PASSWORD_MIN_LENGTH) {
            $errors['new_password'] = 'Password must be at least ' . PASSWORD_MIN_LENGTH . ' characters.';
        } elseif (strlen($newPassword) > PASSWORD_MAX_LENGTH) {
            $errors['new_password'] = 'Password can be at most ' . PASSWORD_MAX_LENGTH . ' characters.';
        }

        if ($newPassword !== $confirmPassword) {
            $errors['confirm_password'] = 'Passwords do not match.';
        }
    }
}

if ($errors) {
    sendError(422, 'Please fix the highlighted fields.', $errors);
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

$userId = (int) $_SESSION['user_id'];

try {
    $pdo->beginTransaction();

    $stmt = $pdo->prepare(
        'SELECT o.id, o.username, o.email, o.password, ut.type AS role
         FROM occupant o
         JOIN user_type ut ON ut.id = o.user_type_id
         WHERE o.id = :id
         FOR UPDATE OF o'
    );
    $stmt->execute(['id' => $userId]);
    $account = $stmt->fetch();

    if (!$account) {
        $pdo->rollBack();
        logout();
        sendError(401, 'Your account no longer exists. Please sign in again.');
    }

    if (!password_verify($currentPassword, $account['password'])) {
        failAndRollBack($pdo, 422, 'Please fix the highlighted fields.', [
            'current_password' => 'This password is not correct.',
        ]);
    }

    if ($method === 'DELETE') {
        if (strtolower($account['role']) === 'admin') {
            $admins = (int) $pdo->query(
                "SELECT COUNT(*) FROM occupant o JOIN user_type ut ON ut.id = o.user_type_id WHERE ut.type = 'admin'"
            )->fetchColumn();

            if ($admins <= 1) {
                failAndRollBack($pdo, 403, 'You are the only admin. Make another user an admin before deleting your account.');
            }
        }

        $stmt = $pdo->prepare(
            "INSERT INTO event_history (event, user_id, data, status)
             VALUES ('user_deleted', :id, CAST(:data AS jsonb), 'succeeded')"
        );
        $stmt->execute([
            'id'   => $userId,
            'data' => json_encode([
                'target_username' => $account['username'],
                'target_role'     => strtolower($account['role']),
                'self'            => true,
            ]),
        ]);

        $stmt = $pdo->prepare(
            "UPDATE event_history
             SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object('actor_username', CAST(:username AS text))
             WHERE user_id = :id"
        );
        $stmt->execute(['username' => $account['username'], 'id' => $userId]);

        $stmt = $pdo->prepare('DELETE FROM occupant WHERE id = :id');
        $stmt->execute(['id' => $userId]);

        $pdo->commit();
        logout();

        echo json_encode(['deleted' => true]);
        exit;
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

    if ($account['username'] !== $username) {
        $changes['username'] = ['from' => $account['username'], 'to' => $username];
    }
    if ($account['email'] !== $email) {
        $changes['email'] = ['from' => $account['email'], 'to' => $email];
    }
    if ($newPassword !== '') {
        $changes['password'] = 'changed';
    }

    if ($changes) {
        $params = ['username' => $username, 'email' => $email, 'id' => $userId];
        $setPassword = '';

        if ($newPassword !== '') {
            $setPassword = ', password = :password';
            $params['password'] = password_hash($newPassword, PASSWORD_DEFAULT);
        }

        $stmt = $pdo->prepare(
            "UPDATE occupant SET username = :username, email = :email$setPassword WHERE id = :id"
        );
        $stmt->execute($params);
    }

    $pdo->commit();
} catch (PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    if ($e->getCode() === '23505') {
        sendError(409, 'An account with this email or username already exists.');
    }

    error_log(($method === 'DELETE' ? 'Deleting' : 'Updating') . ' own account failed: ' . $e->getMessage());
    sendError(500, $method === 'DELETE'
        ? 'Could not delete your account. Please try again.'
        : 'Could not save your profile. Please try again.');
}

if ($newPassword !== '') {
    session_regenerate_id(true);
}

$_SESSION['username'] = $username;
$_SESSION['email'] = $email;

echo json_encode([
    'user'    => ['username' => $username, 'email' => $email],
    'changed' => (bool) $changes,
]);
