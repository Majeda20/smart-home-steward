<?php
    const TEMPERATURE_UNITS = ['celsius', 'fahrenheit'];
    const ROOM_ID_PATTERN = '/^[a-z0-9_]+$/';
    const MAX_HIDDEN_ROOMS = 200;

    function defaultPreferences(): array
    {
        return [
            'temperature_unit' => 'celsius',
            'hidden_rooms'     => [],
        ];
    }

    function isValidRoomId($roomId): bool
    {
        return is_string($roomId) && strlen($roomId) <= 100 && preg_match(ROOM_ID_PATTERN, $roomId);
    }

    function normalizePreferences(array $settings): array
    {
        $preferences = defaultPreferences();

        if (in_array($settings['temperature_unit'] ?? null, TEMPERATURE_UNITS, true)) {
            $preferences['temperature_unit'] = $settings['temperature_unit'];
        }

        if (isset($settings['hidden_rooms']) && is_array($settings['hidden_rooms'])) {
            $rooms = array_values(array_unique(array_filter($settings['hidden_rooms'], 'isValidRoomId')));
            sort($rooms);
            $preferences['hidden_rooms'] = array_slice($rooms, 0, MAX_HIDDEN_ROOMS);
        }

        return $preferences;
    }

    function fetchPreferences(PDO $pdo, int $userId): array
    {
        $stmt = $pdo->prepare('SELECT settings FROM user_preference WHERE occupant_id = :id');
        $stmt->execute(['id' => $userId]);
        $settings = $stmt->fetchColumn();
        $settings = $settings === false ? [] : json_decode($settings, true);

        return normalizePreferences(is_array($settings) ? $settings : []);
    }

    function currentPreferences(): array
    {
        if (isset($_SESSION['preferences']) && is_array($_SESSION['preferences'])) {
            return normalizePreferences($_SESSION['preferences']);
        }

        if (!isset($_SESSION['user_id'])) {
            return defaultPreferences();
        }

        $configPath = require __DIR__ . '/config-path.php';

        if (!is_readable($configPath)) {
            return defaultPreferences();
        }

        ob_start();
        require __DIR__ . '/connection.php';
        ob_end_clean();

        if (!isset($pdo)) {
            return defaultPreferences();
        }

        try {
            $_SESSION['preferences'] = fetchPreferences($pdo, (int) $_SESSION['user_id']);
        } catch (PDOException $e) {
            error_log('Loading preferences failed: ' . $e->getMessage());
            return defaultPreferences();
        }

        return $_SESSION['preferences'];
    }

    function isCelsiusUnit(string $unit): bool
    {
        return in_array($unit, ['°C', '℃', 'C'], true);
    }

    function displayTemperature(?float $celsius, array $preferences): ?float
    {
        if ($celsius === null || $preferences['temperature_unit'] !== 'fahrenheit') {
            return $celsius;
        }

        return $celsius * 9 / 5 + 32;
    }

    function displayTemperatureUnit(array $preferences): string
    {
        return $preferences['temperature_unit'] === 'fahrenheit' ? '°F' : '°C';
    }
