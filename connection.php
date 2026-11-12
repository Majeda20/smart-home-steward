<?php
    $configPath = require __DIR__ . '/config-path.php';

    if (!is_readable($configPath)) {
        error_log('Database config not found at: ' . $configPath);
        echo '<script>alert(' . json_encode('Error: database configuration is missing (see config.example.php).') . ');</script>';
        exit;
    }

    $config = require $configPath;

    $dsn = sprintf(
        'pgsql:host=%s;port=%s;dbname=%s;sslmode=require',
        $config['host'],
        $config['port'] ?? 5432,
        $config['dbname'] ?? 'postgres'
    );
    try {
        $pdo = new PDO($dsn, $config['user'], $config['password'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    } catch (PDOException $e) {
        error_log('Database connection failed: ' . $e->getMessage());
        echo '<script>alert(' . json_encode('Error connecting to the database.') . ');</script>';
    }
