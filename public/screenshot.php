<?php
/**
 * 生产静态/PHP 站点截图与录屏文件落盘接口
 * POST /screenshot.php -> 保存至 /data/screenshots/<filename> 并返回可公开访问的 publicFileUrl
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function respondJson(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    respondJson(405, ['error' => 'Method Not Allowed']);
}

$raw = file_get_contents('php://input');
$body = json_decode($raw ?: '{}', true);
if (!is_array($body)) {
    respondJson(400, ['error' => 'Invalid JSON']);
}

$dataUrl = isset($body['imageDataUrl']) && is_string($body['imageDataUrl']) ? $body['imageDataUrl'] : '';
$marker = ';base64,';
$idx = strpos($dataUrl, $marker);
if ($idx === false) {
    respondJson(400, ['error' => 'Invalid base64 dataUrl']);
}

$header = substr($dataUrl, 0, $idx);
$base64 = substr($dataUrl, $idx + strlen($marker));
$binary = base64_decode($base64, true);
if ($binary === false || strlen($binary) === 0) {
    respondJson(400, ['error' => 'Empty media data']);
}

$isVideo = strpos($header, 'data:video/') === 0;
$ext = $isVideo ? (strpos($header, 'mp4') !== false ? 'mp4' : 'webm') : 'png';
$prefix = $isVideo ? 'recording' : 'screenshot';
$stamp = (int) round(microtime(true) * 1000);
$filename = "{$prefix}-{$stamp}.{$ext}";

$dir = __DIR__ . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'screenshots';
if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
    respondJson(500, ['error' => 'Cannot create data/screenshots directory']);
}

$filePath = $dir . DIRECTORY_SEPARATOR . $filename;
if (@file_put_contents($filePath, $binary) === false) {
    respondJson(500, ['error' => 'Cannot write media file']);
}

$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host = $_SERVER['HTTP_HOST'] ?? 'localhost';
$publicFileUrl = "{$scheme}://{$host}/data/screenshots/{$filename}";

respondJson(200, [
    'ok' => true,
    'mode' => 'client_relay',
    'publicFileUrl' => $publicFileUrl,
    'fileUrl' => $publicFileUrl,
]);

