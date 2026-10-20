// Shared barcode scanner — lazy-loads the self-hosted /html5-qrcode.min.js on first use
// (not on page load), then drives one Html5Qrcode camera session. Global, no
// imports/exports, matching resize-image.js's pattern: load with
// `<script is:inline src="/barcode-scanner.js">`, then call window.createBarcodeScanner().
//
// Usage:
//   const scanner = window.createBarcodeScanner('reader-element-id')
//   await scanner.start((decodedText) => { ... })  // decodedText already sanitized to [0-9Xx]
//   await scanner.stop()
//   scanner.isRunning()
//
// Extracted from scan.astro's original inline implementation — add.astro, add-item.astro
// and offline.astro each still have their own separate copy (see CLEANUP.md).

let scannerLibLoading = null
function loadScannerLib() {
  if (window.Html5Qrcode) return Promise.resolve(true)
  if (scannerLibLoading) return scannerLibLoading
  scannerLibLoading = new Promise((resolve) => {
    const s = document.createElement('script')
    s.src = '/html5-qrcode.min.js'
    s.onload = () => resolve(true)
    s.onerror = () => resolve(false)
    document.head.appendChild(s)
  })
  return scannerLibLoading
}

window.createBarcodeScanner = function (containerId) {
  let scanner = null
  let running = false

  async function start(onDecode) {
    const ok = await loadScannerLib()
    if (!ok || typeof Html5Qrcode === 'undefined') {
      throw new Error('Scanner could not be loaded. Check your connection.')
    }
    scanner = new Html5Qrcode(containerId)
    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 150 } },
        (decodedText) => onDecode(decodedText.replace(/[^0-9Xx]/g, '')),
        () => {}
      )
      running = true
    } catch (err) {
      running = false
      throw err
    }
  }

  async function stop() {
    if (scanner && running) {
      try {
        await scanner.stop()
      } catch (e) {}
    }
    running = false
  }

  return {
    start,
    stop,
    isRunning: () => running,
  }
}
