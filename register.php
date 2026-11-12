<?php
require __DIR__ . '/../session.php';

redirectIfLoggedIn(homeUrl());

const USERNAME_PATTERN = '/^[A-Za-z0-9_.-]{3,50}$/';
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72;

$values = ['username' => '', 'email' => ''];
$errors = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $values['username'] = trim($_POST['username'] ?? '');
    $values['email'] = strtolower(trim($_POST['email'] ?? ''));
    $password = $_POST['password'] ?? '';
    $confirmPassword = $_POST['confirm_password'] ?? '';

    if ($values['username'] === '') {
        $errors['username'] = 'Username is required.';
    } elseif (!preg_match(USERNAME_PATTERN, $values['username'])) {
        $errors['username'] = 'Username must be 3-50 characters: letters, numbers, ".", "_" or "-".';
    }

    if ($values['email'] === '') {
        $errors['email'] = 'Email is required.';
    } elseif (strlen($values['email']) > 255 || !filter_var($values['email'], FILTER_VALIDATE_EMAIL)) {
        $errors['email'] = 'Please enter a valid email address.';
    }

    if ($password === '') {
        $errors['password'] = 'Password is required.';
    } elseif (strlen($password) < PASSWORD_MIN_LENGTH) {
        $errors['password'] = 'Password must be at least ' . PASSWORD_MIN_LENGTH . ' characters.';
    } elseif (strlen($password) > PASSWORD_MAX_LENGTH) {
        $errors['password'] = 'Password can be at most ' . PASSWORD_MAX_LENGTH . ' characters.';
    }

    if ($confirmPassword === '') {
        $errors['confirm-password'] = 'Please confirm your password.';
    } elseif ($password !== $confirmPassword) {
        $errors['confirm-password'] = 'Passwords do not match.';
    }

    if (!$errors) {
        require __DIR__ . '/../connection.php';

        if (!isset($pdo)) {
            $errors['form'] = 'Registration is unavailable right now. Please try again later.';
        } else {
            try {
                $stmt = $pdo->prepare(
                    'SELECT email, username FROM occupant
                     WHERE email = :email OR LOWER(username) = LOWER(:username)'
                );
                $stmt->execute(['email' => $values['email'], 'username' => $values['username']]);

                foreach ($stmt->fetchAll() as $existing) {
                    if ($existing['email'] === $values['email']) {
                        $errors['email'] = 'An account with this email already exists.';
                    }
                    if (strcasecmp($existing['username'], $values['username']) === 0) {
                        $errors['username'] = 'This username is already taken.';
                    }
                }

                if (!$errors) {
                    $stmt = $pdo->prepare(
                        "INSERT INTO occupant (username, email, password, user_type_id)
                         VALUES (:username, :email, :password, (SELECT id FROM user_type WHERE type = 'user'))"
                    );
                    $stmt->execute([
                        'username' => $values['username'],
                        'email'    => $values['email'],
                        'password' => password_hash($password, PASSWORD_DEFAULT),
                    ]);

                    header('Location: login.php');
                    exit;
                }
            } catch (PDOException $e) {
                if ($e->getCode() === '23505') {
                    $errors['form'] = 'An account with this email or username already exists.';
                } else {
                    error_log('Registration failed: ' . $e->getMessage());
                    $errors['form'] = 'Something went wrong. Please try again.';
                }
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

    <title>Create an Account | Smart Home Steward</title>

    <link rel="stylesheet" href="css/register.css">
</head>

<body>

<main class="register-page">

    <section class="brand-panel" aria-label="Smart Home Steward">

        <div class="brand-content">

            <div class="brand">
                <img class="home-icon" src="../images/icons/home.svg" alt="">

                <span class="brand-name">STW</span>
            </div>

            <p class="brand-message">
                Register to control your living space from a single point
            </p>

        </div>

    </section>


    <section class="form-panel">

        <div class="register-container">

            <header class="register-header">
                <h1>Create an account</h1>
                <p>Enter your details to get started.</p>
            </header>

            <?php if (isset($errors['form'])): ?>
                <p class="form-error" role="alert"><?= e($errors['form']) ?></p>
            <?php endif; ?>


            <form class="register-form" method="post" action="register.php" novalidate>

                <div class="form-group">

                    <label for="username">Username</label>

                    <input
                        type="text"
                        id="username"
                        name="username"
                        placeholder="Choose a username"
                        autocomplete="username"
                        aria-describedby="username-error"
                        value="<?= e($values['username']) ?>"<?= errorAttributes('username', $errors) ?>
                    >

                    <p
                        class="error-message"
                        id="username-error"
                        aria-live="polite"
                    ><?= e($errors['username'] ?? '') ?></p>

                </div>


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
                            placeholder="Create a password"
                            autocomplete="new-password"
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


                <div class="form-group">

                    <label for="confirm-password">Confirm password</label>

                    <div class="password-field">

                        <input
                            type="password"
                            id="confirm-password"
                            name="confirm_password"
                            placeholder="Enter your password again"
                            autocomplete="new-password"
                            aria-describedby="confirm-password-error"<?= errorAttributes('confirm-password', $errors) ?>
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
                        id="confirm-password-error"
                        aria-live="polite"
                    ><?= e($errors['confirm-password'] ?? '') ?></p>

                </div>


                <button type="submit" class="create-account-button">
                    Create account
                    <span aria-hidden="true">→</span>
                </button>

            </form>


            <p class="sign-in-text">
                Already have an account?
                <a href="login.php">Sign in.</a>
            </p>

        </div>

    </section>

</main>


<script src="js/register.js"></script>

</body>
</html>