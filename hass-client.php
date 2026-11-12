<?php

class HassException extends RuntimeException
{
}

function loadHassConfig(): array
{
    $configPath = require __DIR__ . '/../../config-path.php';

    return is_readable($configPath) ? require $configPath : [];
}

function hassCall(array $config, string $path, ?array $body = null, int $timeout = 10): string
{
    $ch = curl_init(rtrim($config['hass_url'], '/') . $path);

    $options = [
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $config['hass_token'],
            'Content-Type: application/json',
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_ENCODING       => '',
    ];

    if ($body !== null) {
        $options[CURLOPT_POST] = true;
        $options[CURLOPT_POSTFIELDS] = json_encode($body);
    }

    curl_setopt_array($ch, $options);

    $response = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($response === false || $status !== 200) {
        error_log("Home Assistant request to $path failed (HTTP $status): $curlError");
        throw new HassException('Could not reach Home Assistant.');
    }

    return $response;
}

function hassRequest(array $config, string $path, ?array $body = null, int $timeout = 10): array
{
    $response = hassCall($config, $path, $body, $timeout);
    $data = json_decode($response, true);

    if (!is_array($data)) {
        error_log('Unexpected Home Assistant response: ' . substr($response, 0, 500));
        throw new HassException('Unexpected response from Home Assistant.');
    }

    return $data;
}

function numericState($state): ?float
{
    return is_numeric($state) ? (float) $state : null;
}

function logDeviceControl(PDO $pdo, string $entityId, string $name, string $service, array $data, ?string $ruleName, bool $ok, int $userId): void
{
    $details = ['service' => $service, 'device_name' => $name];

    if ($ruleName !== null) {
        $details['rule_name'] = $ruleName;
    }

    $stmt = $pdo->prepare(
        "INSERT INTO event_history (event, user_id, entity_id, data, status)
         VALUES ('device_control', :user_id, :entity_id, CAST(:data AS jsonb), :status)"
    );
    $stmt->execute([
        'user_id'   => $userId,
        'entity_id' => $entityId,
        'data'      => json_encode($details + $data),
        'status'    => $ok ? 'succeeded' : 'failed',
    ]);
}
