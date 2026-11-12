<?php
require __DIR__ . '/../../session.php';
require __DIR__ . '/history-events.php';

header('Content-Type: application/json');

if (!isLoggedIn()) {
    sendError(401, 'Not logged in.');
}

respondWithHistory(['device', 'situations'], 'eh.user_id = :scope_user', ['scope_user' => (int) $_SESSION['user_id']], false);
