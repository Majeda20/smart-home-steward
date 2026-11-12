<?php
require __DIR__ . '/../session.php';
require_once __DIR__ . '/../user-preferences.php';

redirectIfLoggedIn(homeUrl());

$values = ['email' => ''];
$errors = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $values['email'] = strtolower(trim($_POST['email'] ?? ''));
    $password = $_POST['password'] ?? '';

    if ($values['email'] === '') {
        $errors['email'] = 'Email is required.';
    } elseif (!filter_var($values['email'], FILTER_VALIDATE_EMAIL)) {
        $errors['email'] = 'Please enter a valid email address.';
    }

    if ($password === '') {
        $errors['password'] = 'Password is required.';
    }

    if (!$errors) {
        require __DIR__ . '/../connection.php';

        if (!isset($pdo)) {
            $errors['form'] = 'Sign in is unavailable right now. Please try again later.';
        } else {
            try {
                $stmt = $pdo->prepare(
                    'SELECT o.id, o.username, o.email, o.password, ut.type AS role
                     FROM occupant o
                     JOIN user_type ut ON ut.id = o.user_type_id
                     WHERE LOWER(o.email) = :email'
                );
                $stmt->execute(['email' => $values['email']]);
                $user = $stmt->fetch();

                if ($user && password_verify($password, $user['password'])) {
                    session_regenerate_id(true);

                    $_SESSION['user_id'] = $user['id'];
                    $_SESSION['username'] = $user['username'];
                    $_SESSION['role'] = $user['role'];
                    $_SESSION['email'] = $user['email'];
                    try {
                        $_SESSION['preferences'] = fetchPreferences($pdo, (int) $user['id']);
                    } catch (PDOException $e) {
                        error_log('Loading preferences at login failed: ' . $e->getMessage());
                    }

                    header('Location: ' . homeUrl());
                    exit;
                }

                $errors['form'] = 'Invalid email or password.';
            } catch (PDOException $e) {
                error_log('Login failed: ' . $e->getMessage());
                $errors['form'] = 'Something went wrong. Please try again.';
            }
        }
    }
}

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function errorAttributes(string $field, array $errors): string
{
    return isset($errors[$field]) ? ' class="input-error" aria-invalid="true"' : '';
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <title>Sign In | Smart Home Steward</title>

    <link rel="stylesheet" href="css/login.css">
</head>

<body>

<main class="login-page">

    <section class="brand-panel" aria-label="Smart Home Steward">

        <div class="brand-content">

            <div class="brand">
                <img class="home-icon" src="../images/icons/home.svg" alt="">

                <span class="brand-name">STW</span>
            </div>

            <p class="brand-message">
                Sign in to control your living space from a single point
            </p>

        </div>

    </section>


    <section class="form-panel">

        <div class="login-container">

            <header class="login-header">
                <h1>Welcome back</h1>
                <p>Sign in to manage your home.</p>
            </header>

            <?php if (isset($errors['form'])): ?>
                <p class="form-error" role="alert"><?= e($errors['form']) ?></p>
            <?php endif; ?>


            <form class="login-form" method="post" action="login.php" novalidate>

                <div class="form-group">

                    <label for="email">Email</label>

                    <input
                        type="email"
                        id="email"
                        name="email"
                        placeholder="Enter your email address"
                        autocomplete="email"
                        aria-describedby="email-error"
                        value="<?= e($values['email']) ?>"<?= errorAttributes('email', $errors) ?>
                    >

                    <p
                        class="error-message"
                        id="email-error"
                        aria-live="polite"
                    ><?= e($errors['email'] ?? '') ?></p>

                </div>


                <div class="form-group">

                    <label for="password">Password</label>

                    <div class="password-field">

                        <input
                            type="password"
                            id="password"
                            name="password"
                            placeholder="Enter your password"
                            autocomplete="current-password"
                            aria-describedby="password-error"<?= errorAttributes('password', $errors) ?>
                        >

                        <button
                            type="button"
                            class="password-toggle"
                            aria-label="Show password"
                        >
                            <img src="../images/icons/eye.svg" alt="">
                        </button>

                    </div>

                    <p
                        class="error-message"
                        id="password-error"
                        aria-live="polite"
                    ><?= e($errors['password'] ?? '') ?></p>

                </div>


                <button type="submit" class="sign-in-button">
                    Sign in
                    <span aria-hidden="true">→</span>
                </button>

            </form>


            <p class="create-account-text">
                Don't have an account?
                <a href="register.php">Create one.</a>
            </p>

        </div>

    </section>

</main>


<script src="js/login.js"></script>

</body>
</html>
