<?php
    if (session_status() === PHP_SESSION_NONE) {
        session_set_cookie_params([
            'lifetime' => 0,
            'path'     => '/',
            'secure'   => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        ini_set('session.use_strict_mode', '1');
        session_start();
    }

    function isLoggedIn(): bool
    {
        return isset($_SESSION['user_id']);
    }

    function requireLogin(string $loginUrl): void
    {
        if (!isLoggedIn()) {
            header('Location: ' . $loginUrl);
            exit;
        }
    }

    function redirectIfLoggedIn(string $url): void
    {
        if (isLoggedIn()) {
            header('Location: ' . $url);
            exit;
        }
    }

    function logout(): void
    {
        $_SESSION = [];

        $params = session_get_cookie_params();
        setcookie(session_name(), '', 
        [
            'expires'  => time() - 42000,
            'path'     => $params['path'],
            'domain'   => $params['domain'],
            'secure'   => $params['secure'],
            'httponly' => $params['httponly'],
            'samesite' => $params['samesite'],
        ]);

        session_destroy();
    }
function isAdmin(): bool
{
    return isset($_SESSION['role']) && strtolower($_SESSION['role']) === 'admin';

}

function homeUrl(): string
{
    return isAdmin() ? 'admin.php' : 'index.php';
}

function requireAdmin(string $redirectUser = 'index.php', string $loginUrl = 'login.php'): void
{
    if (!isLoggedIn()) {
        header('Location: ' . $loginUrl);
        exit;
    }

    if (!isAdmin()) {
        header('Location: ' . $redirectUser);
        exit;
    }
}