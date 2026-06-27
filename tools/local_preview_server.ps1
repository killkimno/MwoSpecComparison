param(
  [int]$Port = 8000,
  [string]$Root = "public"
)

$ErrorActionPreference = "Stop"

function Get-ContentType {
  param([string]$Path)

  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".html" { return "text/html; charset=utf-8" }
    ".css" { return "text/css; charset=utf-8" }
    ".js" { return "text/javascript; charset=utf-8" }
    ".json" { return "application/json; charset=utf-8" }
    ".png" { return "image/png" }
    ".jpg" { return "image/jpeg" }
    ".jpeg" { return "image/jpeg" }
    ".svg" { return "image/svg+xml" }
    default { return "application/octet-stream" }
  }
}

function Write-Response {
  param(
    [System.IO.Stream]$Stream,
    [int]$StatusCode,
    [string]$Reason,
    [string]$ContentType,
    [byte[]]$Body,
    [bool]$HeadOnly = $false
  )

  if ($null -eq $Body) {
    $Body = [byte[]]::new(0)
  }

  $header = "HTTP/1.1 $StatusCode $Reason`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if (-not $HeadOnly -and $Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
}

function Get-RequestPath {
  param([string]$Target)

  $path = ($Target -split "\?", 2)[0]
  $path = [System.Uri]::UnescapeDataString($path.TrimStart("/"))
  if ([string]::IsNullOrWhiteSpace($path)) {
    return "index.html"
  }
  return $path
}

$resolvedRoot = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Root).Path)
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()
      while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line -or $line -eq "") {
          break
        }
      }

      if ([string]::IsNullOrWhiteSpace($requestLine)) {
        Write-Response $stream 400 "Bad Request" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Bad request"))
        continue
      }

      $parts = $requestLine -split " "
      $method = $parts[0]
      $target = $parts[1]
      $headOnly = $method -eq "HEAD"
      if ($method -ne "GET" -and $method -ne "HEAD") {
        Write-Response $stream 405 "Method Not Allowed" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Method not allowed"))
        continue
      }

      $requestPath = Get-RequestPath $target
      $fullPath = [System.IO.Path]::GetFullPath((Join-Path $resolvedRoot $requestPath))
      if (-not $fullPath.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-Response $stream 403 "Forbidden" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Forbidden"))
        continue
      }

      if ([System.IO.Directory]::Exists($fullPath)) {
        $fullPath = Join-Path $fullPath "index.html"
      }

      if (-not [System.IO.File]::Exists($fullPath)) {
        Write-Response $stream 404 "Not Found" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Not found"))
        continue
      }

      $bytes = [System.IO.File]::ReadAllBytes($fullPath)
      Write-Response $stream 200 "OK" (Get-ContentType $fullPath) $bytes $headOnly
    } catch {
      try {
        Write-Response $stream 500 "Server Error" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Server error"))
      } catch {
      }
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
