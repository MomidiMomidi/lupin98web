// ルパン９８ Web移植版 メインアプリケーション
// オリジナルの LUPIN.ASM (1993) の演出タイミング・音声再生をベースに、
// TVタイトル表示（高精細拡大・フォント選択・ルビ・自由位置合わせ）を再現。
"use strict";

(() => {
  const VIRTUAL_W = 640;
  const VIRTUAL_H = 400;
  const RENDER_SCALE = 3; // 内部解像度 1920 x 1200
  const VSYNC_MS = 1000 / 56.42; // PC-98 400ライン時の垂直同期周期（約17.72ms）
  const BASE_CHAR_UNIT = 64; // 640px幅に対して全角10文字 = 1文字64px

  const FONT_PRESETS = {
    "shippori": {
      family: '"Shippori Mincho", "HGP明朝E", "HG明朝E", "Noto Serif JP", "Yu Mincho", serif',
      forceRegularWeight: false
    },
    "yu-mincho": {
      family: '"Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "Noto Serif JP", serif',
      forceRegularWeight: false
    },
    "ms-mincho": {
      family: '"MS Mincho", "ＭＳ 明朝", "Shippori Mincho", "Yu Mincho", "Hiragino Mincho ProN", serif',
      forceRegularWeight: false
    },
    "ms-gothic": {
      family: '"MS Gothic", "ＭＳ ゴシック", "Osaka-Mono", monospace',
      forceRegularWeight: false
    },
    "yu-gothic": {
      family: '"Yu Gothic", "YuGothic", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif',
      forceRegularWeight: false
    },
    "meiryo": {
      family: '"Meiryo", "メイリオ", "Hiragino Sans", "Noto Sans JP", sans-serif',
      forceRegularWeight: false
    },
    "biz-gothic": {
      family: '"BIZ UDGothic", "BIZ UDPGothic", "MS Gothic", "Noto Sans JP", sans-serif',
      forceRegularWeight: false
    },
    "maru-gothic": {
      family: '"HGMaruGothicMPRO", "HG丸ｺﾞｼｯｸM-PRO", "Hiragino Maru Gothic ProN", "Zen Maru Gothic", sans-serif',
      forceRegularWeight: false
    },
    "kyokasho": {
      family: '"UD Digi Kyokasho N-B", "UD デジタル 教科書体 N-B", "HG正楷書体-PRO", "Yu Mincho", serif',
      forceRegularWeight: false
    },
    "ultra-gothic": {
      family: '"Dela Gothic One", "HGP創英角ｺﾞｼｯｸUB", "HGS創英角ｺﾞｼｯｸUB", "Noto Sans JP", sans-serif',
      forceRegularWeight: true // 元から極太のため疑似太字での潰れを防止
    }
  };

  const RUBY_SIZE_RATIO = {
    small: 0.19,
    normal: 0.24,
    large: 0.30
  };

  const BOX_FONT_RATIO = 0.62;
  const BOX_HEIGHT_RATIO = 0.88;
  const BOX_PAD_X_RATIO = 0.34;
  const BOX_STROKE_RATIO = 0.036;

  const SAMPLE_PRESETS = {
    "ep1-ruby": "     ルパン三《さん》世《せい》     \n        颯《さつ》爽《そう》登《とう》場《じょう》  ",
    "multiline": "  真《ま》夜《よ》中《なか》の\n    怪《かい》盗《とう》ルパン\n       参《さん》上《じょう》！",
    "single": "おなかのラッパがプ～"
  };

  // DOM要素参照
  const els = {
    crtFrame: document.getElementById("crtFrame"),
    canvas: document.getElementById("lupinCanvas"),
    statusText: document.getElementById("statusText"),
    playBtn: document.getElementById("playBtn"),
    randomPlayBtn: document.getElementById("randomPlayBtn"),
    skipBtn: document.getElementById("skipBtn"),
    previewBtn: document.getElementById("previewBtn"),
    clearPreviewBtn: document.getElementById("clearPreviewBtn"),
    savePngBtn: document.getElementById("savePngBtn"),
    episodeSelect: document.getElementById("episodeSelect"),
    randomPickBtn: document.getElementById("randomPickBtn"),
    titleInput: document.getElementById("titleInput"),
    insertRubyBtn: document.getElementById("insertRubyBtn"),
    insertBoxBtn: document.getElementById("insertBoxBtn"),
    insertHalfSpaceBtn: document.getElementById("insertHalfSpaceBtn"),
    insertFullSpaceBtn: document.getElementById("insertFullSpaceBtn"),
    clearInputBtn: document.getElementById("clearInputBtn"),
    generateUrlBtn: document.getElementById("generateUrlBtn"),
    generatedUrlInput: document.getElementById("generatedUrlInput"),
    copyUrlBtn: document.getElementById("copyUrlBtn"),
    fontSelect: document.getElementById("fontSelect"),
    customFontRow: document.getElementById("customFontRow"),
    customFontInput: document.getElementById("customFontInput"),
    boldCheck: document.getElementById("boldCheck"),
    rubySizeSelect: document.getElementById("rubySizeSelect"),
    speedSelect: document.getElementById("speedSelect"),
    fgColorInput: document.getElementById("fgColorInput"),
    bgColorInput: document.getElementById("bgColorInput"),
    colorHexLabel: document.getElementById("colorHexLabel"),
    rubyDuringTypeCheck: document.getElementById("rubyDuringTypeCheck"),
    scanlineCheck: document.getElementById("scanlineCheck"),
    muteCheck: document.getElementById("muteCheck"),
    volumeRange: document.getElementById("volumeRange"),
    volumeLabel: document.getElementById("volumeLabel")
  };

  const ctx = els.canvas.getContext("2d");
  let episodesList = [];

  // =========================================================================
  // 音声再生エンジン (15,360 Hz 8bit Unsigned PCM)
  // =========================================================================
  class LupinAudioEngine {
    constructor() {
      this.audioCtx = null;
      this.masterGain = null;
      this.highpass = null;
      this.buffer1 = null;
      this.buffer2 = null;
      this.activePcm1 = null;
      this.activePcm2 = null;
      this.pcm2Resolver = null;
    }

    async ensureContext() {
      const audioData = window.LUPIN_AUDIO_DATA;
      if (!audioData) return false;

      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioContextClass();

        // DCオフセットによるクリックノイズを抑えるハイパスフィルター
        this.highpass = this.audioCtx.createBiquadFilter();
        this.highpass.type = "highpass";
        this.highpass.frequency.value = 35;

        this.masterGain = this.audioCtx.createGain();
        this.updateGain();

        this.highpass.connect(this.masterGain);
        this.masterGain.connect(this.audioCtx.destination);

        this.buffer1 = this.decodePcmBuffer(audioData.pcm1Base64, audioData.sampleRate, true);
        this.buffer2 = this.decodePcmBuffer(audioData.pcm2Base64, audioData.sampleRate, false);
      }
      if (this.audioCtx.state === "suspended") {
        // 自動再生制限環境で Promise が返らない場合に備えてタイムアウトを設ける
        await Promise.race([
          this.audioCtx.resume().catch(() => {}),
          new Promise((resolve) => window.setTimeout(resolve, 60))
        ]);
      }
      return this.audioCtx.state === "running";
    }

    decodePcmBuffer(base64Str, sampleRate, fixTrailingZeroSpike) {
      const bin = window.atob(base64Str);
      const len = bin.length;
      const raw = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        raw[i] = bin.charCodeAt(i);
      }

      // LUPIN1.SPK 末尾の単発0スパイクによるポップノイズを抑える
      if (fixTrailingZeroSpike && len >= 2 && raw[len - 1] === 0 && raw[len - 2] > 64) {
        raw[len - 1] = raw[len - 2];
      }

      const audioBuffer = this.audioCtx.createBuffer(1, len, sampleRate);
      const channel = audioBuffer.getChannelData(0);
      const fadeSamples = Math.min(28, Math.floor(len / 8));

      for (let i = 0; i < len; i++) {
        let sample = (raw[i] - 128) / 128;
        if (i < fadeSamples) {
          sample *= i / fadeSamples;
        } else if (i >= len - fadeSamples) {
          sample *= (len - 1 - i) / fadeSamples;
        }
        channel[i] = sample;
      }
      return audioBuffer;
    }

    updateGain() {
      if (!this.masterGain || !this.audioCtx) return;
      const muted = els.muteCheck.checked;
      const vol = Number(els.volumeRange.value) / 100;
      this.masterGain.gain.setValueAtTime(muted ? 0 : vol, this.audioCtx.currentTime);
    }

    stopAll() {
      if (this.activePcm1) {
        try {
          this.activePcm1.stop();
        } catch (_) {
          // 既に停止済みの場合を無視
        }
        this.activePcm1.disconnect();
        this.activePcm1 = null;
      }
      if (this.activePcm2) {
        try {
          this.activePcm2.stop();
        } catch (_) {
          // 既に停止済みの場合を無視
        }
        this.activePcm2.disconnect();
        this.activePcm2 = null;
      }
      if (this.pcm2Resolver) {
        const resolve = this.pcm2Resolver;
        this.pcm2Resolver = null;
        resolve(false);
      }
    }

    playTypeSound() {
      if (!this.audioCtx || this.audioCtx.state !== "running" || !this.buffer1) return;
      if (this.activePcm1) {
        try {
          this.activePcm1.stop();
        } catch (_) {
          // 停止済み無視
        }
        this.activePcm1.disconnect();
        this.activePcm1 = null;
      }
      const src = this.audioCtx.createBufferSource();
      src.buffer = this.buffer1;
      src.connect(this.highpass);
      src.onended = () => {
        if (this.activePcm1 === src) {
          this.activePcm1 = null;
        }
      };
      this.activePcm1 = src;
      src.start();
    }

    playFinishSound() {
      if (!this.audioCtx || this.audioCtx.state !== "running" || !this.buffer2) {
        return Promise.resolve(false);
      }
      this.stopAll();
      return new Promise((resolve) => {
        const src = this.audioCtx.createBufferSource();
        src.buffer = this.buffer2;
        src.connect(this.highpass);
        this.pcm2Resolver = resolve;
        src.onended = () => {
          if (this.activePcm2 === src) {
            this.activePcm2 = null;
          }
          if (this.pcm2Resolver === resolve) {
            this.pcm2Resolver = null;
            resolve(true);
          }
        };
        this.activePcm2 = src;
        src.start();
      });
    }
  }

  const audioEngine = new LupinAudioEngine();

  // =========================================================================
  // 文字種判定・パーサー（改行・空白・ルビ記法対応）
  // =========================================================================
  function isSpaceChar(ch) {
    return ch === " " || ch === "　" || ch === "\t";
  }

  function isHalfWidthChar(ch) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) return false;
    return (cp >= 0x0020 && cp <= 0x007e) || (cp >= 0xff61 && cp <= 0xff9f);
  }

  function getCharWidthUnits(ch) {
    if (ch === "\t") return 2.0;
    return isHalfWidthChar(ch) ? 0.5 : 1.0;
  }

  function isKanjiWaitChar(ch) {
    return /[\u4E00-\u9FFF\u3400-\u4DBF々〆ヶ〇㊙]/.test(ch);
  }

  function classifyAutoRubyCategory(ch) {
    if (/[\u4E00-\u9FFF\u3400-\u4DBF々〆ヶ〇㊙]/.test(ch)) return "kanji";
    if (/[\u30A1-\u30FA\u30FC・]/.test(ch)) return "katakana";
    if (/[0-9A-Za-z０-９Ａ-Ｚａ-ｚ]/.test(ch)) return "alnum";
    return "other";
  }

  function makeCharItem(ch) {
    return {
      char: ch,
      widthUnits: getCharWidthUnits(ch),
      isKanji: isKanjiWaitChar(ch)
    };
  }

  function stripInlineRubyMarkers(str) {
    return str.replace(/｜|\|/g, "").replace(/《[^》]*》/g, "");
  }

  function measureBoxWidthUnits(boxText, options) {
    const padUnits = BOX_FONT_RATIO * BOX_PAD_X_RATIO * 2;
    if (options && options.fontCfg && typeof ctx !== "undefined" && ctx) {
      const boxFontPx = BASE_CHAR_UNIT * BOX_FONT_RATIO;
      ctx.save();
      ctx.font = buildFontString(boxFontPx, options.fontCfg);
      const textW = ctx.measureText(boxText).width;
      ctx.restore();
      return textW / BASE_CHAR_UNIT + padUnits;
    }
    const approxUnits = Array.from(boxText).reduce((acc, c) => acc + getCharWidthUnits(c), 0);
    return approxUnits * BOX_FONT_RATIO + padUnits;
  }

  function parseLineWithRuby(lineStr, options = null) {
    const chars = Array.from(lineStr);
    const segments = [];
    let i = 0;

    const pushPlainChar = (ch) => {
      if (isSpaceChar(ch)) {
        segments.push({
          type: "space",
          char: ch,
          widthUnits: getCharWidthUnits(ch)
        });
      } else {
        const item = makeCharItem(ch);
        segments.push({
          type: "group",
          chars: [item],
          ruby: null,
          totalWidthUnits: item.widthUnits
        });
      }
    };

    while (i < chars.length) {
      const ch = chars[i];

      // エスケープ記号 (\｜, \|, \《, \{, \【, \[ 等)
      if (ch === "\\" && i + 1 < chars.length) {
        pushPlainChar(chars[i + 1]);
        i += 2;
        continue;
      }

      // 四角枠記法：【文字列】 または [[文字列]]
      if (ch === "【") {
        let closeIdx = -1;
        for (let j = i + 1; j < chars.length; j++) {
          if (chars[j] === "】") {
            closeIdx = j;
            break;
          }
        }
        if (closeIdx > i + 1) {
          const boxText = stripInlineRubyMarkers(chars.slice(i + 1, closeIdx).join(""));
          if (boxText.length > 0) {
            segments.push({
              type: "box",
              text: boxText,
              widthUnits: measureBoxWidthUnits(boxText, options)
            });
            i = closeIdx + 1;
            continue;
          }
        }
      }

      if (ch === "[" && i + 1 < chars.length && chars[i + 1] === "[") {
        let closeIdx = -1;
        for (let j = i + 2; j < chars.length - 1; j++) {
          if (chars[j] === "]" && chars[j + 1] === "]") {
            closeIdx = j;
            break;
          }
        }
        if (closeIdx > i + 2) {
          const boxText = stripInlineRubyMarkers(chars.slice(i + 2, closeIdx).join(""));
          if (boxText.length > 0) {
            segments.push({
              type: "box",
              text: boxText,
              widthUnits: measureBoxWidthUnits(boxText, options)
            });
            i = closeIdx + 2;
            continue;
          }
        }
      }

      // 明示開始ルビ記法： ｜親文字《るび》 または |親文字《るび》
      if (ch === "｜" || ch === "|") {
        let openIdx = -1;
        let closeIdx = -1;
        for (let j = i + 1; j < chars.length; j++) {
          if (chars[j] === "｜" || chars[j] === "|") break;
          if (chars[j] === "《") {
            openIdx = j;
            break;
          }
        }
        if (openIdx !== -1) {
          for (let k = openIdx + 1; k < chars.length; k++) {
            if (chars[k] === "》") {
              closeIdx = k;
              break;
            }
          }
        }
        if (openIdx > i + 1 && closeIdx > openIdx) {
          const baseChars = chars.slice(i + 1, openIdx);
          const rubyText = chars.slice(openIdx + 1, closeIdx).join("");
          const allNonSpace = baseChars.every((c) => !isSpaceChar(c));
          if (allNonSpace) {
            const items = baseChars.map(makeCharItem);
            const totalW = items.reduce((acc, it) => acc + it.widthUnits, 0);
            segments.push({
              type: "group",
              chars: items,
              ruby: rubyText.length > 0 ? rubyText : null,
              totalWidthUnits: totalW
            });
            i = closeIdx + 1;
            continue;
          }
        }
      }

      // 補助記法：{親文字|るび}
      if (ch === "{") {
        let sepIdx = -1;
        let closeIdx = -1;
        for (let j = i + 1; j < chars.length; j++) {
          if (chars[j] === "}") {
            closeIdx = j;
            break;
          }
          if ((chars[j] === "|" || chars[j] === "｜") && sepIdx === -1) {
            sepIdx = j;
          }
        }
        if (sepIdx > i + 1 && closeIdx > sepIdx) {
          const baseChars = chars.slice(i + 1, sepIdx);
          const rubyText = chars.slice(sepIdx + 1, closeIdx).join("");
          if (baseChars.every((c) => !isSpaceChar(c))) {
            const items = baseChars.map(makeCharItem);
            const totalW = items.reduce((acc, it) => acc + it.widthUnits, 0);
            segments.push({
              type: "group",
              chars: items,
              ruby: rubyText.length > 0 ? rubyText : null,
              totalWidthUnits: totalW
            });
            i = closeIdx + 1;
            continue;
          }
        }
      }

      // 省略ルビ記法：漢字《かんじ》
      if (ch === "《") {
        let closeIdx = -1;
        for (let k = i + 1; k < chars.length; k++) {
          if (chars[k] === "》") {
            closeIdx = k;
            break;
          }
        }
        if (closeIdx > i && segments.length > 0) {
          const lastSeg = segments[segments.length - 1];
          if (lastSeg.type === "group" && lastSeg.ruby === null) {
            const rubyText = chars.slice(i + 1, closeIdx).join("");
            const targetCat = classifyAutoRubyCategory(lastSeg.chars[0].char);
            let startSegIdx = segments.length - 1;
            if (targetCat !== "other") {
              while (startSegIdx > 0) {
                const prev = segments[startSegIdx - 1];
                if (
                  prev.type === "group" &&
                  prev.ruby === null &&
                  prev.chars.length === 1 &&
                  classifyAutoRubyCategory(prev.chars[0].char) === targetCat
                ) {
                  startSegIdx--;
                } else {
                  break;
                }
              }
            }
            const mergedItems = [];
            for (let s = startSegIdx; s < segments.length; s++) {
              mergedItems.push(...segments[s].chars);
            }
            const totalW = mergedItems.reduce((acc, it) => acc + it.widthUnits, 0);
            segments.splice(startSegIdx, segments.length - startSegIdx, {
              type: "group",
              chars: mergedItems,
              ruby: rubyText.length > 0 ? rubyText : null,
              totalWidthUnits: totalW
            });
            i = closeIdx + 1;
            continue;
          }
        }
      }

      pushPlainChar(ch);
      i += 1;
    }

    // 末尾空白を除いた実質的な幅（位置合わせ用の先頭・途中空白はそのまま残す）
    let runningW = 0;
    let effectiveWidthUnits = 0;
    let hasVisibleChars = false;
    let hasTypeChars = false;
    let hasRuby = false;
    for (const seg of segments) {
      runningW += seg.type === "space" ? seg.widthUnits : (seg.type === "box" ? seg.widthUnits : seg.totalWidthUnits);
      if (seg.type === "group") {
        hasVisibleChars = true;
        hasTypeChars = true;
        effectiveWidthUnits = runningW;
        if (seg.ruby) hasRuby = true;
      } else if (seg.type === "box") {
        hasVisibleChars = true;
        effectiveWidthUnits = runningW;
      }
    }

    return {
      segments,
      effectiveWidthUnits,
      hasVisibleChars,
      hasTypeChars,
      hasRuby
    };
  }

  function parseTitleText(rawText, options = null) {
    const normalized = rawText.replace(/\r\n?/g, "\n");
    const rawLines = normalized.split("\n");
    return rawLines.map((line) => parseLineWithRuby(line, options));
  }

  // タイプライター演出シーケンスの生成（空白・空行・四角枠は完全にスキップ）
  function buildTypeSequence(parsedLines) {
    const steps = [];
    let hasPrevLineChars = false;

    for (const line of parsedLines) {
      if (!line.hasTypeChars) continue;

      if (hasPrevLineChars) {
        steps.push({ type: "linePause", vsyncCount: 16 });
      }

      for (const seg of line.segments) {
        if (seg.type === "space" || seg.type === "box") continue;
        for (const chItem of seg.chars) {
          steps.push({
            type: "char",
            char: chItem.char,
            isHalf: chItem.widthUnits <= 0.5,
            ruby: seg.ruby,
            vsyncCount: chItem.isKanji ? 11 : 8
          });
        }
      }
      hasPrevLineChars = true;
    }

    return steps;
  }

  // =========================================================================
  // レイアウト計算（仮想 640x400 座標系）
  // =========================================================================
  function computeLayout(parsedLines, options) {
    const lineCount = parsedLines.length;
    const maxWUnits = parsedLines.reduce((m, ln) => Math.max(m, ln.effectiveWidthUnits), 0);
    const anyRuby = parsedLines.some((ln) => ln.hasRuby);
    const rubyRatio = RUBY_SIZE_RATIO[options.rubySize] || RUBY_SIZE_RATIO.normal;

    // 10文字幅を超えた場合は横方向にフィットさせる
    let scale = maxWUnits > 10 ? (VIRTUAL_W - 24) / (maxWUnits * BASE_CHAR_UNIT) : 1.0;

    const getMetrics = (sc) => {
      const charSize = BASE_CHAR_UNIT * sc;
      const rubySize = charSize * rubyRatio;
      const rubyGap = Math.max(2, charSize * 0.06);
      const lineGap = Math.max(6, charSize * 0.25);
      const rubyLineGap = Math.max(lineGap * 0.9, charSize * 0.22);
      return { charSize, rubySize, rubyGap, lineGap, rubyLineGap };
    };

    // 縦方向に収まるまで必要ならさらに縮小
    const measureTotalHeight = (sc) => {
      const m = getMetrics(sc);
      let total = 0;
      for (let i = 0; i < lineCount; i++) {
        const ln = parsedLines[i];
        const rubyBlock = ln.hasRuby ? m.rubySize + m.rubyGap : 0;
        if (i > 0) {
          total += ln.hasRuby ? m.rubyLineGap : m.lineGap;
        }
        total += rubyBlock + m.charSize;
      }
      return total;
    };

    if (lineCount > 2 || anyRuby || scale < 1.0) {
      const maxAllowH = VIRTUAL_H - 28;
      const h = measureTotalHeight(scale);
      if (h > maxAllowH) {
        scale *= maxAllowH / h;
      }
    }

    const { charSize, rubySize, rubyGap, lineGap, rubyLineGap } = getMetrics(scale);

    // 本家準拠の位置決め（1～2行・ルビ無し・縮小無し）
    const isClassicLayout = lineCount <= 2 && !anyRuby && scale === 1.0;

    const lineTopYs = [];
    if (isClassicLayout) {
      if (lineCount <= 1) {
        lineTopYs.push(136);
      } else {
        lineTopYs.push(96, 176);
      }
    } else {
      const totalH = measureTotalHeight(scale);
      let cursorY = (VIRTUAL_H - totalH) / 2;
      for (let i = 0; i < lineCount; i++) {
        const ln = parsedLines[i];
        if (i > 0) {
          cursorY += ln.hasRuby ? rubyLineGap : lineGap;
        }
        if (ln.hasRuby) {
          cursorY += rubySize + rubyGap;
        }
        lineTopYs.push(cursorY);
        cursorY += charSize;
      }
    }

    const startX = maxWUnits <= 10 && scale === 1.0
      ? 0
      : Math.max(12, (VIRTUAL_W - maxWUnits * charSize) / 2);

    const drawLines = [];
    for (let i = 0; i < lineCount; i++) {
      const ln = parsedLines[i];
      const y = lineTopYs[i];
      let x = startX;
      const groups = [];
      const boxes = [];

      for (const seg of ln.segments) {
        if (seg.type === "space") {
          x += seg.widthUnits * charSize;
          continue;
        }

        if (seg.type === "box") {
          const boxW = seg.widthUnits * charSize;
          const boxH = charSize * BOX_HEIGHT_RATIO;
          const boxY = y + (charSize - boxH) / 2;
          boxes.push({
            text: seg.text,
            x,
            y: boxY,
            width: boxW,
            height: boxH,
            fontSize: charSize * BOX_FONT_RATIO
          });
          x += boxW;
          continue;
        }

        const segStartX = x;
        const charEntries = [];
        for (const chItem of seg.chars) {
          const w = chItem.widthUnits * charSize;
          charEntries.push({
            char: chItem.char,
            x,
            y,
            width: w,
            height: charSize,
            isHalf: chItem.widthUnits <= 0.5
          });
          x += w;
        }

        groups.push({
          chars: charEntries,
          ruby: seg.ruby,
          x: segStartX,
          y,
          width: x - segStartX,
          rubyY: y - rubyGap - rubySize,
          rubySize
        });
      }

      drawLines.push({ y, groups, boxes });
    }

    return {
      scale,
      charSize,
      rubySize,
      drawLines
    };
  }

  // =========================================================================
  // フォント解決 & 描画ロジック（高精細TVタイトル表示）
  // =========================================================================
  function getActiveFontConfig() {
    const key = els.fontSelect.value;
    if (key === "custom") {
      const custom = els.customFontInput.value.trim();
      return {
        key: `custom:${custom}`,
        family: custom ? `${custom}, "Yu Gothic", sans-serif` : '"Yu Gothic", sans-serif',
        bold: els.boldCheck.checked
      };
    }
    const preset = FONT_PRESETS[key] || FONT_PRESETS.shippori;
    return {
      key,
      family: preset.family,
      bold: preset.forceRegularWeight ? false : els.boldCheck.checked
    };
  }

  function buildFontString(pxSize, fontCfg) {
    const weight = fontCfg.bold ? "700 " : "400 ";
    return `${weight}${pxSize}px ${fontCfg.family}`;
  }

  // 垂直方向の視覚的中心を揃えるための計測キャッシュ
  const baselineOffsetCache = new Map();
  function getVerticalCenterOffset(fontStr, fontPx) {
    const key = `${fontStr}|${fontPx}`;
    if (baselineOffsetCache.has(key)) return baselineOffsetCache.get(key);

    ctx.save();
    ctx.font = fontStr;
    const m = ctx.measureText("漢あ");
    ctx.restore();

    let offset = 0;
    if (typeof m.actualBoundingBoxAscent === "number" && typeof m.actualBoundingBoxDescent === "number") {
      offset = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    } else {
      offset = fontPx * 0.35;
    }
    baselineOffsetCache.set(key, offset);
    return offset;
  }

  function getOptions() {
    return {
      fontCfg: getActiveFontConfig(),
      rubySize: els.rubySizeSelect.value,
      speed: Number(els.speedSelect.value) || 1,
      fgColor: els.fgColorInput.value || "#ffffff",
      bgColor: els.bgColorInput.value || "#000000",
      rubyDuringType: els.rubyDuringTypeCheck.checked
    };
  }

  function clearScreen(bgColor) {
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
  }

  function drawRubyString(rubyStr, centerX, rubyY, rubySize, options) {
    if (!rubyStr) return;

    const s = RENDER_SCALE;
    const fontPx = rubySize * s;
    const fontStr = buildFontString(fontPx, options.fontCfg);

    ctx.save();
    ctx.font = fontStr;
    ctx.fillStyle = options.fgColor;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";

    const naturalW = ctx.measureText(rubyStr).width;
    const centerPx = centerX * s;
    const boxCenterY = (rubyY + rubySize / 2) * s + getVerticalCenterOffset(fontStr, fontPx);

    // 親文字（またはグループ）の中央へ中央寄せで配置（画面端をはみ出す場合のみ補正）
    const maxAllowedW = (VIRTUAL_W - 16) * s;
    const compressX = naturalW > maxAllowedW ? maxAllowedW / naturalW : 1;
    const finalW = naturalW * compressX;
    let clampedCenter = centerPx;
    if (clampedCenter - finalW / 2 < 8 * s) clampedCenter = 8 * s + finalW / 2;
    if (clampedCenter + finalW / 2 > (VIRTUAL_W - 8) * s) clampedCenter = (VIRTUAL_W - 8) * s - finalW / 2;

    ctx.translate(clampedCenter, boxCenterY);
    if (compressX < 1) {
      ctx.scale(compressX, 1);
    }
    ctx.fillText(rubyStr, 0, 0);

    ctx.restore();
  }

  // 全体表示（最終タイトル画面）の描画
  function renderFullTitle(parsedLines, options) {
    clearScreen(options.bgColor);

    const layout = computeLayout(parsedLines, options);
    const s = RENDER_SCALE;
    const fontPx = layout.charSize * s;
    const fontStr = buildFontString(fontPx, options.fontCfg);
    const baselineOffset = getVerticalCenterOffset(fontStr, fontPx);

    ctx.save();
    ctx.font = fontStr;
    ctx.fillStyle = options.fgColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    for (const ln of layout.drawLines) {
      for (const grp of ln.groups) {
        for (const ch of grp.chars) {
          const cx = (ch.x + ch.width / 2) * s;
          const cy = (ch.y + ch.height / 2) * s + baselineOffset;
          ctx.fillText(ch.char, cx, cy);
        }
      }
    }
    ctx.restore();

    for (const ln of layout.drawLines) {
      for (const grp of ln.groups) {
        if (grp.ruby) {
          drawRubyString(
            grp.ruby,
            grp.x + grp.width / 2,
            grp.rubyY,
            grp.rubySize,
            options
          );
        }
      }

      // 四角枠文字列の描画
      for (const box of ln.boxes) {
        const boxFontPx = box.fontSize * s;
        const boxFontStr = buildFontString(boxFontPx, options.fontCfg);
        const boxOffset = getVerticalCenterOffset(boxFontStr, boxFontPx);

        ctx.save();
        ctx.strokeStyle = options.fgColor;
        ctx.lineWidth = Math.max(1.5, layout.charSize * BOX_STROKE_RATIO) * s;
        ctx.strokeRect(box.x * s, box.y * s, box.width * s, box.height * s);

        ctx.font = boxFontStr;
        ctx.fillStyle = options.fgColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(
          box.text,
          (box.x + box.width / 2) * s,
          (box.y + box.height / 2) * s + boxOffset
        );
        ctx.restore();
      }
    }
  }

  // タイプライター演出（1文字ずつの大きな拡大表示）
  function renderTypeStepChar(step, options) {
    clearScreen(options.bgColor);

    // 本家 disp_text_font 準拠：画面中央 256x256 (x=192, y=64)
    const boxSize = 256;
    const boxY = 64;
    const s = RENDER_SCALE;
    const fontPx = boxSize * s;
    const fontStr = buildFontString(fontPx, options.fontCfg);
    const baselineOffset = getVerticalCenterOffset(fontStr, fontPx);

    ctx.save();
    ctx.font = fontStr;
    ctx.fillStyle = options.fgColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(step.char, (VIRTUAL_W / 2) * s, (boxY + boxSize / 2) * s + baselineOffset);
    ctx.restore();

    if (options.rubyDuringType && step.ruby) {
      drawRubyString(step.ruby, VIRTUAL_W / 2, 16, 32, options);
    }
  }

  // =========================================================================
  // 再生セッション管理
  // =========================================================================
  let playSessionId = 0;
  let isPlaying = false;
  let lastViewState = "empty"; // "empty" | "preview" | "typing" | "completed"
  let activeTypeStep = null;

  function setStatus(text, playing) {
    els.statusText.textContent = text;
    els.statusText.classList.toggle("is-playing", Boolean(playing));
    els.skipBtn.disabled = !playing;
  }

  // 進行中の再生セッションと音声を停止・リセットする共通ヘルパー
  function stopPlaybackSession() {
    playSessionId += 1;
    isPlaying = false;
    activeTypeStep = null;
    audioEngine.stopAll();
  }

  function sleepWithCancel(ms, sessionId) {
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = (now) => {
        if (sessionId !== playSessionId) {
          resolve(false);
          return;
        }
        if (now - start >= ms) {
          resolve(true);
          return;
        }
        window.requestAnimationFrame(tick);
      };
      window.requestAnimationFrame(tick);
    });
  }

  function refreshCurrentScreen() {
    const options = getOptions();
    if (lastViewState === "empty") {
      clearScreen(options.bgColor);
    } else if (lastViewState === "typing" && activeTypeStep) {
      renderTypeStepChar(activeTypeStep, options);
    } else {
      const parsed = parseTitleText(els.titleInput.value, options);
      renderFullTitle(parsed, options);
    }
  }

  async function startPlayback({ isAutoStart = false } = {}) {
    const rawText = els.titleInput.value;
    const options = getOptions();
    const parsedLines = parseTitleText(rawText, options);
    const hasAnyVisible = parsedLines.some((ln) => ln.hasVisibleChars);
    const steps = buildTypeSequence(parsedLines);

    if (!hasAnyVisible) {
      stopPlaybackSession();
      lastViewState = "empty";
      clearScreen(options.bgColor);
      setStatus("表示できる文字がありません（空白のみ）", false);
      return;
    }

    stopPlaybackSession();
    const currentId = playSessionId;
    isPlaying = true;

    let audioReady = false;
    try {
      audioReady = await audioEngine.ensureContext();
    } catch (_) {
      audioReady = false;
    }
    if (currentId !== playSessionId) return;

    setStatus("タイプ演出再生中…", true);
    const speedFactor = options.speed;

    for (const step of steps) {
      if (currentId !== playSessionId) return;

      if (step.type === "linePause") {
        lastViewState = "typing";
        activeTypeStep = null;
        clearScreen(options.bgColor);
        const ok = await sleepWithCancel((step.vsyncCount * VSYNC_MS) / speedFactor, currentId);
        if (!ok) return;
        continue;
      }

      if (step.type === "char") {
        const latestOpts = getOptions();
        lastViewState = "typing";
        activeTypeStep = step;
        audioEngine.playTypeSound();
        renderTypeStepChar(step, latestOpts);

        const ok = await sleepWithCancel((step.vsyncCount * VSYNC_MS) / latestOpts.speed, currentId);
        if (!ok) return;
      }
    }

    if (currentId !== playSessionId) return;

    // 全体表示＆タイトル音声再生
    activeTypeStep = null;
    lastViewState = "completed";
    const finalOpts = getOptions();
    renderFullTitle(parseTitleText(els.titleInput.value, finalOpts), finalOpts);
    setStatus("タイトルコール再生中…", true);

    await audioEngine.playFinishSound();
    if (currentId !== playSessionId) return;

    isPlaying = false;
    if (isAutoStart && !audioReady && !els.muteCheck.checked) {
      setStatus("自動再生完了（ブラウザ制限により無音・画面クリックで音声再生できます）", false);
    } else {
      setStatus("再生完了（設定変更で即時反映できます）", false);
    }
  }

  function skipToFinalTitle() {
    stopPlaybackSession();
    lastViewState = "completed";
    refreshCurrentScreen();
    setStatus("全体表示へスキップしました", false);
  }

  // =========================================================================
  // サブタイトルデータ（lupin-titles.js）読み込み・UI初期化
  // =========================================================================
  function normalizeEpisodes() {
    const rawList = Array.isArray(window.LUPIN_TITLES) ? window.LUPIN_TITLES : [];
    episodesList = rawList.map((entry, idx) => {
      let text = "";
      let epNumber = idx + 1;
      // 将来の1期・3期等の追加に備え、期番号を保持する（現在のデータ配列はアニメ2期）
      let epSeason = 2;

      if (Array.isArray(entry)) {
        text = entry.map((ln) => String(ln)).join("\n");
      } else if (typeof entry === "string") {
        text = entry;
      } else if (entry && typeof entry === "object") {
        if (typeof entry.season === "number") epSeason = entry.season;
        if (typeof entry.number === "number") epNumber = entry.number;
        if (typeof entry.text === "string") {
          text = entry.text;
        } else if (Array.isArray(entry.lines)) {
          text = entry.lines.map((ln) => String(ln)).join("\n");
        } else {
          const lines = [];
          if (typeof entry.line1 === "string") lines.push(entry.line1);
          if (typeof entry.line2 === "string") lines.push(entry.line2);
          text = lines.join("\n");
        }
      }

      // ドロップダウン表示用にルビ記法を除き、四角枠文字列を末尾の（）へ配置したタイトルを生成
      const parsed = parseTitleText(text);
      const boxTexts = [];
      const plainLines = [];
      for (const ln of parsed) {
        const lineParts = [];
        for (const seg of ln.segments) {
          if (seg.type === "box") {
            const cleanedBox = seg.text.trim();
            if (cleanedBox) boxTexts.push(cleanedBox);
          } else if (seg.type === "space") {
            lineParts.push(" ");
          } else {
            lineParts.push(seg.chars.map((c) => c.char).join(""));
          }
        }
        const cleanedLine = lineParts.join("").replace(/\s+/g, " ").trim();
        if (cleanedLine) plainLines.push(cleanedLine);
      }

      let mainTitle = "";
      for (const lineStr of plainLines) {
        if (!mainTitle) {
          mainTitle = lineStr;
        } else if (/[\u3041-\u3096ー]$/.test(mainTitle) || /^[\u3041-\u3096（]/.test(lineStr)) {
          mainTitle += lineStr;
        } else {
          mainTitle += ` ${lineStr}`;
        }
      }

      const boxSuffix = boxTexts.map((b) => `（${b}）`).join("");
      const summaryText = `${mainTitle}${boxSuffix}`.trim();

      return {
        season: epSeason,
        number: epNumber,
        text,
        summary: summaryText || "(空白)"
      };
    });
  }

  function populateEpisodes() {
    const frag = document.createDocumentFragment();
    for (const ep of episodesList) {
      const opt = document.createElement("option");
      opt.value = String(ep.number);
      opt.textContent = `第${String(ep.number).padStart(3, "0")}話：${ep.summary}`;
      frag.appendChild(opt);
    }
    els.episodeSelect.appendChild(frag);
  }

  function findEpisode(epNumber, season = null) {
    if (epNumber === null || !Number.isSafeInteger(epNumber) || epNumber < 1) {
      return null;
    }
    return episodesList.find((item) => item.number === epNumber && (season === null || item.season === season)) ?? null;
  }

  function loadEpisodeEntry(ep) {
    if (!ep) return;
    els.episodeSelect.value = String(ep.number);
    els.titleInput.value = ep.text;
  }

  function loadEpisodeToInput(epNumber, season = null) {
    loadEpisodeEntry(findEpisode(epNumber, season));
  }

  function pickRandomEpisode(candidates = episodesList) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const idx = Math.floor(Math.random() * candidates.length);
    return candidates[idx];
  }

  function insertTextAtCursor(text, selectStartOffset = null, selectEndOffset = null) {
    const ta = els.titleInput;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    ta.setRangeText(text, start, end, "end");
    ta.focus();
    if (selectStartOffset !== null && selectEndOffset !== null) {
      ta.setSelectionRange(start + selectStartOffset, start + selectEndOffset);
    }
    onInputChanged();
  }

  function insertRubyAtSelection() {
    const ta = els.titleInput;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const selected = ta.value.slice(start, end);

    if (selected.length > 0) {
      const wrapped = `｜${selected}《るび》`;
      ta.setRangeText(wrapped, start, end, "end");
      ta.focus();
      const rubyStart = start + 1 + selected.length + 1;
      ta.setSelectionRange(rubyStart, rubyStart + 2);
      onInputChanged();
    } else {
      insertTextAtCursor("｜漢字《かんじ》", 1, 3);
    }
  }

  function insertBoxAtSelection() {
    const ta = els.titleInput;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const selected = ta.value.slice(start, end);

    if (selected.length > 0) {
      const wrapped = `【${selected}】`;
      ta.setRangeText(wrapped, start, end, "end");
      ta.focus();
      onInputChanged();
    } else {
      insertTextAtCursor("【前編】", 1, 3);
    }
  }

  function buildShareUrl() {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("text", els.titleInput.value);
    return url.toString();
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        return false;
      }
    }
    return false;
  }

  function clearGeneratedUrl() {
    if (els.generatedUrlInput.value !== "") {
      els.generatedUrlInput.value = "";
    }
    els.copyUrlBtn.disabled = true;
  }

  async function handleGenerateUrl() {
    const shareUrl = buildShareUrl();
    els.generatedUrlInput.value = shareUrl;
    els.copyUrlBtn.disabled = false;
    els.generatedUrlInput.focus();
    els.generatedUrlInput.select();

    const copied = await copyTextToClipboard(shareUrl);
    if (!isPlaying) {
      setStatus(copied ? "再生用URLを生成してコピーしました" : "再生用URLを生成しました", false);
    }
  }

  // 入力欄のテキストを画面にプレビュー表示する
  function showPreview() {
    stopPlaybackSession();
    const rawText = els.titleInput.value;
    const options = getOptions();
    const parsed = parseTitleText(rawText, options);
    const hasAnyVisible = parsed.some((ln) => ln.hasVisibleChars);

    if (!hasAnyVisible) {
      lastViewState = "empty";
      clearScreen(options.bgColor);
      setStatus(rawText.length === 0 ? "表示テキスト入力欄が空です" : "表示できる文字がありません（空白のみ）", false);
      return;
    }

    lastViewState = "preview";
    renderFullTitle(parsed, options);
    setStatus("プレビュー表示中", false);
  }

  // 画面上のプレビューや再生表示を消去して待機状態に戻す
  function clearPreview(statusText = "プレビューを消去しました") {
    stopPlaybackSession();
    lastViewState = "empty";
    clearScreen(getOptions().bgColor);
    setStatus(statusText, false);
  }

  function onInputChanged() {
    clearGeneratedUrl();
    if (isPlaying) return;
    // すでにプレビュー表示中のときのみ、位置調整などの編集を即時反映する
    if (lastViewState === "preview") {
      refreshCurrentScreen();
      setStatus("プレビュー表示中", false);
    }
  }

  function bindEvents() {
    els.playBtn.addEventListener("click", () => {
      startPlayback();
    });

    els.randomPlayBtn.addEventListener("click", () => {
      const ep = pickRandomEpisode();
      if (ep) loadEpisodeEntry(ep);
      clearGeneratedUrl();
      startPlayback();
    });

    els.skipBtn.addEventListener("click", () => {
      skipToFinalTitle();
    });

    els.previewBtn.addEventListener("click", () => {
      showPreview();
    });

    els.clearPreviewBtn.addEventListener("click", () => {
      clearPreview();
    });

    els.crtFrame.addEventListener("click", () => {
      if (isPlaying) {
        skipToFinalTitle();
      } else {
        startPlayback();
      }
    });

    els.savePngBtn.addEventListener("click", () => {
      const link = document.createElement("a");
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      link.download = `lupin98-${ts}.png`;
      link.href = els.canvas.toDataURL("image/png");
      link.click();
    });

    els.episodeSelect.addEventListener("change", () => {
      loadEpisodeToInput(Number(els.episodeSelect.value));
      clearGeneratedUrl();
      clearPreview("収録タイトルを入力欄に読み込みました");
    });

    els.randomPickBtn.addEventListener("click", () => {
      const ep = pickRandomEpisode();
      if (ep) loadEpisodeEntry(ep);
      clearGeneratedUrl();
      clearPreview("収録タイトルを入力欄に読み込みました");
    });

    document.querySelectorAll(".chip-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.sample;
        if (SAMPLE_PRESETS[key]) {
          els.titleInput.value = SAMPLE_PRESETS[key];
          clearGeneratedUrl();
          clearPreview("サンプルを入力欄に読み込みました");
        }
      });
    });

    els.insertRubyBtn.addEventListener("click", insertRubyAtSelection);
    els.insertBoxBtn.addEventListener("click", insertBoxAtSelection);
    els.insertHalfSpaceBtn.addEventListener("click", () => insertTextAtCursor(" "));
    els.insertFullSpaceBtn.addEventListener("click", () => insertTextAtCursor("　"));
    els.clearInputBtn.addEventListener("click", () => {
      els.titleInput.value = "";
      els.titleInput.focus();
      onInputChanged();
    });

    els.titleInput.addEventListener("input", onInputChanged);

    els.generateUrlBtn.addEventListener("click", handleGenerateUrl);
    els.copyUrlBtn.addEventListener("click", async () => {
      const urlVal = els.generatedUrlInput.value;
      if (!urlVal) return;
      els.generatedUrlInput.focus();
      els.generatedUrlInput.select();
      const copied = await copyTextToClipboard(urlVal);
      if (!isPlaying) {
        setStatus(copied ? "URLをクリップボードにコピーしました" : "URLを選択しました（手動でコピーしてください）", false);
      }
    });
    els.generatedUrlInput.addEventListener("click", () => {
      if (els.generatedUrlInput.value) {
        els.generatedUrlInput.select();
      }
    });

    els.fontSelect.addEventListener("change", () => {
      const isCustom = els.fontSelect.value === "custom";
      els.customFontRow.classList.toggle("hidden", !isCustom);
      baselineOffsetCache.clear();
      refreshCurrentScreen();
    });

    els.customFontInput.addEventListener("input", () => {
      baselineOffsetCache.clear();
      refreshCurrentScreen();
    });

    const immediateRefreshIds = [
      els.boldCheck,
      els.rubySizeSelect,
      els.fgColorInput,
      els.bgColorInput,
      els.rubyDuringTypeCheck
    ];
    for (const el of immediateRefreshIds) {
      el.addEventListener("change", () => {
        if (el === els.boldCheck) {
          baselineOffsetCache.clear();
        }
        els.colorHexLabel.textContent = `${els.fgColorInput.value.toUpperCase()} / ${els.bgColorInput.value.toUpperCase()}`;
        refreshCurrentScreen();
      });
    }

    document.querySelectorAll(".color-preset").forEach((btn) => {
      btn.addEventListener("click", () => {
        els.fgColorInput.value = btn.dataset.fg;
        els.bgColorInput.value = btn.dataset.bg;
        els.colorHexLabel.textContent = `${btn.dataset.fg.toUpperCase()} / ${btn.dataset.bg.toUpperCase()}`;
        refreshCurrentScreen();
      });
    });

    els.scanlineCheck.addEventListener("change", () => {
      els.crtFrame.classList.toggle("has-scanlines", els.scanlineCheck.checked);
    });

    els.volumeRange.addEventListener("input", () => {
      els.volumeLabel.textContent = `${els.volumeRange.value}%`;
      audioEngine.updateGain();
    });
    els.muteCheck.addEventListener("change", () => audioEngine.updateGain());

    // オンライン環境のWebフォント読み込み完了時にキャッシュをクリアして再描画
    if (document.fonts && typeof document.fonts.addEventListener === "function") {
      document.fonts.addEventListener("loadingdone", () => {
        baselineOffsetCache.clear();
        refreshCurrentScreen();
      });
    }
  }

  const RANDOM_PARAM_KEYWORDS = new Set(["random", "rand", "rnd"]);

  // URL引数 ep（形式: "<期>-<話数|random|rand|rnd|0>"、例: "2-50", "2-random", "2-0"）を解決する
  function resolveEpisodeFromUrlParam(rawValue) {
    if (rawValue === null) return null;
    const normalized = rawValue.trim().toLowerCase();
    const match = normalized.match(/^(\d+)-([a-z0-9]+)$/);
    if (!match) return null;

    const season = Number(match[1]);
    const target = match[2];
    if (!Number.isSafeInteger(season) || season < 1) {
      return null;
    }

    const seasonEpisodes = episodesList.filter((item) => item.season === season);
    if (seasonEpisodes.length === 0) {
      return null;
    }

    const isUnsignedInt = /^\d+$/.test(target);
    if (RANDOM_PARAM_KEYWORDS.has(target) || (isUnsignedInt && Number(target) === 0)) {
      return pickRandomEpisode(seasonEpisodes);
    }

    return isUnsignedInt ? findEpisode(Number(target), season) : null;
  }

  async function init() {
    normalizeEpisodes();
    populateEpisodes();
    bindEvents();

    const params = new URLSearchParams(window.location.search);
    const urlEpRaw = params.get("ep");
    const urlText = params.get("text") ?? params.get("t");
    const resolvedEp = resolveEpisodeFromUrlParam(urlEpRaw);

    let shouldAutoPlay = false;
    if (resolvedEp) {
      loadEpisodeEntry(resolvedEp);
      shouldAutoPlay = true;
    } else if (urlEpRaw === null && urlText !== null) {
      els.titleInput.value = urlText;
      shouldAutoPlay = true;
    }

    if (shouldAutoPlay) {
      // プレビューを経ずに背景色だけの状態から自動再生を開始する
      lastViewState = "empty";
      clearScreen(getOptions().bgColor);
      if (document.fonts && document.fonts.ready) {
        await Promise.race([
          document.fonts.ready.catch(() => {}),
          new Promise((resolve) => window.setTimeout(resolve, 400))
        ]);
      }
      startPlayback({ isAutoStart: true });
      return;
    }

    if (episodesList.length > 0) {
      loadEpisodeEntry(episodesList[0]);
    }
    clearPreview("待機中");
  }

  init();
})();
