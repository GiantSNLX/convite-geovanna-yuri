/* Gerador autossuficiente de BR Code Pix (EMV BACEN) e matriz QR ISO/IEC 18004 (ECC M, Versões 1-10) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WeddingQR = factory();
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var GF_EXP = new Uint8Array(512);
  var GF_LOG = new Uint8Array(256);
  (function initGf() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) GF_EXP[j] = GF_EXP[j - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  function rsGeneratorPoly(deg) {
    var poly = [1];
    for (var i = 0; i < deg; i++) {
      var next = new Array(poly.length + 1).fill(0);
      var factor = GF_EXP[i];
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], factor);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    var gen = rsGeneratorPoly(ecLen);
    var res = new Array(data.length + ecLen).fill(0);
    for (var i = 0; i < data.length; i++) res[i] = data[i];
    for (var j = 0; j < data.length; j++) {
      var coef = res[j];
      if (coef !== 0) {
        for (var k = 1; k < gen.length; k++) {
          res[j + k] ^= gfMul(gen[k], coef);
        }
      }
    }
    return res.slice(data.length);
  }

  // Tabela ECC M (Versões 1 a 10): [dataBytesCap, ecPerBlock, g1Blocks, g1DataBytes, g2Blocks, g2DataBytes]
  var ECC_M_SPEC = [
    null,
    [14, 10, 1, 16, 0, 0],
    [26, 16, 1, 28, 0, 0],
    [42, 26, 1, 44, 0, 0],
    [62, 18, 2, 32, 0, 0],
    [84, 24, 2, 43, 0, 0],
    [106, 16, 4, 27, 0, 0],
    [122, 18, 4, 31, 0, 0],
    [152, 22, 2, 38, 2, 39],
    [180, 22, 3, 36, 2, 37],
    [213, 26, 4, 43, 1, 44]
  ];

  var ALIGN_POS = [
    null,
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50]
  ];

  function toUtf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(String(str)));
    var utf8 = unescape(encodeURIComponent(String(str)));
    var out = [];
    for (var i = 0; i < utf8.length; i++) out.push(utf8.charCodeAt(i));
    return out;
  }

  function pickVersion(byteLen) {
    for (var v = 1; v <= 10; v++) {
      if (byteLen <= ECC_M_SPEC[v][0]) return v;
    }
    throw new Error('Conteúdo excede a capacidade do QR Code.');
  }

  function encodeCodewords(bytes, version) {
    var spec = ECC_M_SPEC[version];
    var totalDataBytes = spec[2] * spec[3] + spec[4] * spec[5];
    var bits = [];
    function pushBits(val, count) {
      for (var i = count - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    }
    // Byte mode (0100) + 8-bit char count (V1-9) or 16-bit char count (V10+)
    pushBits(4, 4);
    pushBits(bytes.length, version >= 10 ? 16 : 8);
    for (var i = 0; i < bytes.length; i++) pushBits(bytes[i], 8);
    var capBits = totalDataBytes * 8;
    var term = Math.min(4, capBits - bits.length);
    for (var t = 0; t < term; t++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    var data = [];
    for (var b = 0; b < bits.length; b += 8) {
      var byteVal = 0;
      for (var k = 0; k < 8; k++) byteVal = (byteVal << 1) | bits[b + k];
      data.push(byteVal);
    }
    var pad = [0xec, 0x11];
    var p = 0;
    while (data.length < totalDataBytes) {
      data.push(pad[p & 1]);
      p++;
    }

    var ecLen = spec[1];
    var blocks = [];
    var ecBlocks = [];
    var offset = 0;
    for (var g1 = 0; g1 < spec[2]; g1++) {
      var blk1 = data.slice(offset, offset + spec[3]);
      offset += spec[3];
      blocks.push(blk1);
      ecBlocks.push(rsEncode(blk1, ecLen));
    }
    for (var g2 = 0; g2 < spec[4]; g2++) {
      var blk2 = data.slice(offset, offset + spec[5]);
      offset += spec[5];
      blocks.push(blk2);
      ecBlocks.push(rsEncode(blk2, ecLen));
    }

    var out = [];
    var maxDataLen = Math.max(spec[3], spec[5] || 0);
    for (var c = 0; c < maxDataLen; c++) {
      for (var bi = 0; bi < blocks.length; bi++) {
        if (c < blocks[bi].length) out.push(blocks[bi][c]);
      }
    }
    for (var ec = 0; ec < ecLen; ec++) {
      for (var ei = 0; ei < ecBlocks.length; ei++) {
        out.push(ecBlocks[ei][ec]);
      }
    }
    return out;
  }

  function createMatrix(size) {
    var mod = [];
    var fn = [];
    for (var r = 0; r < size; r++) {
      mod.push(new Uint8Array(size));
      fn.push(new Uint8Array(size));
    }
    return { size: size, mod: mod, fn: fn };
  }

  function setFn(m, r, c, dark) {
    if (r < 0 || c < 0 || r >= m.size || c >= m.size) return;
    m.mod[r][c] = dark ? 1 : 0;
    m.fn[r][c] = 1;
  }

  function drawFinder(m, row, col) {
    for (var dr = -1; dr <= 7; dr++) {
      for (var dc = -1; dc <= 7; dc++) {
        var r = row + dr;
        var c = col + dc;
        if (r < 0 || c < 0 || r >= m.size || c >= m.size) continue;
        var dark =
          dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 &&
          (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        setFn(m, r, c, dark);
      }
    }
  }

  function drawAlignment(m, row, col) {
    for (var dr = -2; dr <= 2; dr++) {
      for (var dc = -2; dc <= 2; dc++) {
        var dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
        setFn(m, row + dr, col + dc, dark);
      }
    }
  }

  function bchFormat(ecBits2, maskPattern) {
    var data = (ecBits2 << 3) | maskPattern;
    var rem = data << 10;
    for (var i = 14; i >= 10; i--) {
      if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
    }
    return ((data << 10) | rem) ^ 0x5412;
  }

  function bchVersion(version) {
    var rem = version << 12;
    for (var i = 17; i >= 12; i--) {
      if ((rem >>> i) & 1) rem ^= 0x1f25 << (i - 12);
    }
    return (version << 12) | rem;
  }

  function drawFormatAndVersion(m, version, maskPattern) {
    // ECC M = 00
    var fmt = bchFormat(0, maskPattern);
    for (var i = 0; i < 15; i++) {
      var dark = ((fmt >>> i) & 1) === 1;
      // Vertical: f0..f5 at (0..5, 8), f6 at (7, 8), f7 at (8, 8), f8..f14 at (size-7..size-1, 8)
      if (i < 6) setFn(m, i, 8, dark);
      else if (i < 8) setFn(m, i + 1, 8, dark);
      else setFn(m, m.size - 15 + i, 8, dark);

      // Horizontal: f0..f7 at (8, size-1..size-8), f8 at (8, 7), f9..f14 at (8, 5..0)
      if (i < 8) setFn(m, 8, m.size - 1 - i, dark);
      else if (i === 8) setFn(m, 8, 7, dark);
      else setFn(m, 8, 14 - i, dark);
    }
    setFn(m, m.size - 8, 8, true);

    if (version >= 7) {
      var ver = bchVersion(version);
      for (var j = 0; j < 18; j++) {
        var vDark = ((ver >>> j) & 1) === 1;
        var a = Math.floor(j / 3);
        var b = (j % 3) + m.size - 11;
        setFn(m, a, b, vDark);
        setFn(m, b, a, vDark);
      }
    }
  }

  function placeData(m, codewords) {
    var bitIdx = 0;
    var totalBits = codewords.length * 8;
    var dir = -1;
    for (var right = m.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var step = 0; step < m.size; step++) {
        var r = dir === -1 ? m.size - 1 - step : step;
        for (var j = 0; j < 2; j++) {
          var c = right - j;
          if (m.fn[r][c]) continue;
          var dark = false;
          if (bitIdx < totalBits) {
            dark = ((codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          m.mod[r][c] = dark ? 1 : 0;
        }
      }
      dir = -dir;
    }
  }

  function maskBit(pattern, r, c) {
    switch (pattern) {
      case 0: return ((r + c) % 2) === 0;
      case 1: return (r % 2) === 0;
      case 2: return (c % 3) === 0;
      case 3: return ((r + c) % 3) === 0;
      case 4: return ((Math.floor(r / 2) + Math.floor(c / 3)) % 2) === 0;
      case 5: return (((r * c) % 2) + ((r * c) % 3)) === 0;
      case 6: return ((((r * c) % 2) + ((r * c) % 3)) % 2) === 0;
      default: return ((((r + c) % 2) + ((r * c) % 3)) % 2) === 0;
    }
  }

  function applyMask(m, pattern) {
    for (var r = 0; r < m.size; r++) {
      for (var c = 0; c < m.size; c++) {
        if (!m.fn[r][c] && maskBit(pattern, r, c)) {
          m.mod[r][c] ^= 1;
        }
      }
    }
  }

  function penaltyScore(m) {
    var n = m.size;
    var score = 0;
    var r, c, run, last, darkCount = 0;

    for (r = 0; r < n; r++) {
      run = 0; last = -1;
      for (c = 0; c < n; c++) {
        var v = m.mod[r][c];
        darkCount += v;
        if (v === last) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1; last = v;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }

    for (c = 0; c < n; c++) {
      run = 0; last = -1;
      for (r = 0; r < n; r++) {
        var v2 = m.mod[r][c];
        if (v2 === last) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1; last = v2;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }

    for (r = 0; r < n - 1; r++) {
      for (c = 0; c < n - 1; c++) {
        var sum = m.mod[r][c] + m.mod[r][c + 1] + m.mod[r + 1][c] + m.mod[r + 1][c + 1];
        if (sum === 0 || sum === 4) score += 3;
      }
    }

    var pA = '10111010000';
    var pB = '00001011101';
    for (r = 0; r < n; r++) {
      var rowStr = '';
      var colStr = '';
      for (c = 0; c < n; c++) {
        rowStr += m.mod[r][c];
        colStr += m.mod[c][r];
      }
      for (c = 0; c <= n - 11; c++) {
        var subR = rowStr.slice(c, c + 11);
        var subC = colStr.slice(c, c + 11);
        if (subR === pA || subR === pB) score += 40;
        if (subC === pA || subC === pB) score += 40;
      }
    }

    var pct = (darkCount * 100) / (n * n);
    var prev5 = Math.abs(Math.floor(pct / 5) * 5 - 50) / 5;
    var next5 = Math.abs(Math.ceil(pct / 5) * 5 - 50) / 5;
    score += Math.min(prev5, next5) * 10;
    return score;
  }

  function generateMatrix(text) {
    var bytes = toUtf8Bytes(text);
    var version = pickVersion(bytes.length);
    var size = version * 4 + 17;
    var codewords = encodeCodewords(bytes, version);

    var bestMask = 0;
    var bestScore = Infinity;
    var bestMatrix = null;

    for (var mask = 0; mask < 8; mask++) {
      var m = createMatrix(size);
      drawFinder(m, 0, 0);
      drawFinder(m, 0, size - 7);
      drawFinder(m, size - 7, 0);
      for (var i = 8; i < size - 8; i++) {
        setFn(m, 6, i, i % 2 === 0);
        setFn(m, i, 6, i % 2 === 0);
      }
      var align = ALIGN_POS[version];
      for (var ai = 0; ai < align.length; ai++) {
        for (var aj = 0; aj < align.length; aj++) {
          var ar = align[ai];
          var ac = align[aj];
          if ((ar < 10 && ac < 10) || (ar < 10 && ac > size - 10) || (ar > size - 10 && ac < 10)) continue;
          drawAlignment(m, ar, ac);
        }
      }
      drawFormatAndVersion(m, version, mask);
      placeData(m, codewords);
      applyMask(m, mask);
      var sc = penaltyScore(m);
      if (sc < bestScore) {
        bestScore = sc;
        bestMask = mask;
        bestMatrix = m.mod;
      }
    }
    return { version: version, mask: bestMask, size: size, modules: bestMatrix };
  }

  function toSvg(text, options) {
    var opts = options || {};
    var margin = opts.margin != null ? opts.margin : 3;
    var fg = opts.color || '#24321e';
    var bg = opts.background || '#fffdf8';
    var qr = generateMatrix(text);
    var dim = qr.size + margin * 2;
    var d = '';
    for (var r = 0; r < qr.size; r++) {
      for (var c = 0; c < qr.size; c++) {
        if (qr.modules[r][c]) {
          d += 'M' + (c + margin) + ',' + (r + margin) + 'h1v1h-1z';
        }
      }
    }
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim + '" role="img" aria-label="QR Code Pix" shape-rendering="crispEdges">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="' + bg + '"/>' +
      '<path d="' + d + '" fill="' + fg + '"/>' +
      '</svg>'
    );
  }

  function emvTag(id, value) {
    var str = String(value || '');
    return id + String(str.length).padStart(2, '0') + str;
  }

  function normalizePixAscii(value, maxLen, fallback) {
    var clean = String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) clean = fallback;
    return clean.slice(0, maxLen);
  }

  function crc16Ccitt(payload) {
    var crc = 0xffff;
    for (var i = 0; i < payload.length; i++) {
      crc ^= payload.charCodeAt(i) << 8;
      for (var b = 0; b < 8; b++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
        crc &= 0xffff;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  function buildPixBrCode(options) {
    var opts = options || {};
    var key = String(opts.key || '').trim();
    if (!key) return '';
    var name = normalizePixAscii(opts.merchantName, 25, 'Yuri Menezes Tanaka');
    var city = normalizePixAscii(opts.merchantCity, 15, 'Manaus');
    var txid = normalizePixAscii(opts.txid, 25, '***').replace(/\s+/g, '') || '***';
    var gui = emvTag('00', 'br.gov.bcb.pix') + emvTag('01', key);
    var body =
      emvTag('00', '01') +
      emvTag('26', gui) +
      emvTag('52', '0000') +
      emvTag('53', '986') +
      emvTag('58', 'BR') +
      emvTag('59', name) +
      emvTag('60', city) +
      emvTag('62', emvTag('05', txid)) +
      '6304';
    return body + crc16Ccitt(body);
  }

  return Object.freeze({
    generateMatrix: generateMatrix,
    toSvg: toSvg,
    buildPixBrCode: buildPixBrCode
  });
}));
