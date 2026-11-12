<?php
require __DIR__ . '/../../session.php';
require __DIR__ . '/history-events.php';

header('Content-Type: application/json');

if (!isLoggedIn()) {
    sendError(401, 'Not logged in.');
}

if (!isAdmin()) {
    sendError(403, 'Only admins can view activity history.');
}

respondWithHistory(array_keys(HISTORY_TYPES));
