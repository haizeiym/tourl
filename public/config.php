<?php
/**
 * 全局可写配置 API（上传到网站根目录即可，无需 Node）
 * 访问：/config.php
 * GET 读取 | PUT 保存 | PUT ?force=1 强制覆盖
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Pragma: no-cache');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, PUT, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$dataDir = __DIR__ . DIRECTORY_SEPARATOR . 'data';
$dataFile = $dataDir . DIRECTORY_SEPARATOR . 'jump-config.json';

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function defaultConfig(): array
{
    return ['updatedAt' => 0, 'items' => []];
}

function readConfig(string $file): array
{
    if (!is_file($file)) {
        return defaultConfig();
    }
    $raw = file_get_contents($file);
    if ($raw === false || $raw === '') {
        return defaultConfig();
    }
    $data = json_decode($raw, true);
    if (!is_array($data) || !isset($data['items']) || !is_array($data['items'])) {
        respond(500, ['error' => '配置文件损坏']);
    }
    $data['updatedAt'] = isset($data['updatedAt']) && is_numeric($data['updatedAt'])
        ? (int) $data['updatedAt']
        : 0;
    return $data;
}

function writeConfig(string $dir, string $file, array $config): void
{
    if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
        respond(500, ['error' => '无法创建 data 目录，请给网站根目录写权限']);
    }
    $json = json_encode($config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    if ($json === false) {
        respond(500, ['error' => 'JSON 编码失败']);
    }
    $tmp = $file . '.tmp';
    if (file_put_contents($tmp, $json . "\n", LOCK_EX) === false) {
        respond(500, ['error' => '写入失败：请确保 data/ 可写（chmod 775）']);
    }
    if (!rename($tmp, $file)) {
        @unlink($tmp);
        respond(500, ['error' => '保存失败']);
    }
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    respond(200, readConfig($dataFile));
}

if ($method === 'PUT') {
    $raw = file_get_contents('php://input');
    $body = json_decode($raw ?: '{}', true);
    if (!is_array($body) || !isset($body['items']) || !is_array($body['items'])) {
        respond(400, ['error' => 'body 须包含 items 数组']);
    }

    $current = readConfig($dataFile);
    $clientUpdatedAt = isset($body['updatedAt']) && is_numeric($body['updatedAt'])
        ? (int) $body['updatedAt']
        : 0;
    $force = isset($_GET['force']) && $_GET['force'] === '1';

    if (!$force && $clientUpdatedAt !== (int) $current['updatedAt']) {
        respond(409, [
            'error' => '配置已被他人更新，请刷新后重试或强制覆盖',
            'serverConfig' => $current,
        ]);
    }

    $next = [
        'updatedAt' => (int) round(microtime(true) * 1000),
        'items' => $body['items'],
    ];
    writeConfig($dataDir, $dataFile, $next);
    respond(200, $next);
}

respond(405, ['error' => 'Method Not Allowed']);
