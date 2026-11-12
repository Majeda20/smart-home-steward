<?php
require __DIR__ . '/../../session.php';
require_once __DIR__ . '/../../user-preferences.php';

header('Content-Type: application/json');

function sendError(int $status, string $message): void
{
    http_response_code($status);
    echo json_encode(['error' => $message]);
    exit;
}

if (!isLoggedIn()) {
    sendError(401, 'Not logged in.');
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendError(405, 'Method not allowed.');
}

if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
    sendError(415, 'Expected a JSON request.');
}

$input = json_decode(file_get_contents('php://input'), true);

if (!is_array($input) || !$input) {
    sendError(400, 'Invalid request.');
}

$unknown = array_diff(array_keys($input), ['temperature_unit', 'hidden_rooms']);

if ($unknown) {
    sendError(400, 'Unknown setting: ' . implode(', ', $unknown) . '.');
}

if (array_key_exists('temperature_unit', $input)
    && !in_array($input['temperature_unit'], TEMPERATURE_UNITS, true)) {
    sendError(422, 'Choose Celsius or Fahrenheit.');
}

if (array_key_exists('hidden_rooms', $input)) {
    $hiddenRooms = $input['hidden_rooms'];

    if (!is_array($hiddenRooms) || array_filter($hiddenRooms, fn($room) => !isValidRoomId($room))) {
        sendError(422, 'Unknown room.');
    }

    if (count($hiddenRooms) > MAX_HIDDEN_ROOMS) {
        sendError(422, 'Too many rooms.');
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

$userId = (int) $_SESSION['user_id'];

try {
    $pdo->beginTransaction();

    $current = fetchPreferences($pdo, $userId);
    $updated = normalizePreferences(array_merge($current, $input));

    $changes = [];

    foreach ($updated as $key => $value) {
        if ($current[$key] !== $value) {
            $changes[$key] = ['from' => $current[$key], 'to' => $value];
        }
    }

    if ($changes) {
        $stmt = $pdo->prepare(
            'INSERT INTO user_preference (occupant_id, settings, updated_at)
             VALUES (:id, CAST(:settings AS jsonb), CURRENT_TIMESTAMP)
             ON CONFLICT (occupant_id)
             DO UPDATE SET settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at'
        );
        $stmt->execute(['id' => $userId, 'settings' => json_encode($updated)]);
    }

    $pdo->commit();
} catch (PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    if ($e->getCode() === '23503') {
        sendError(401, 'Your account no longer exists. Please sign in again.');
    }

    error_log('Saving preferences failed: ' . $e->getMessage());
    sendError(500, 'Could not save your preferences. Please try again.');
}

$_SESSION['preferences'] = $updated;

echo json_encode(['preferences' => $updated, 'changed' => (bool) $changes]);
