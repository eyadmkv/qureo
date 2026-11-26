// ==UserScript==
// @name         SPRIX Lesson Exporter
// @namespace    https://github.com/eyadmkv/qureo
// @version      1.0.0
// @description  Export the visible SPRIX lesson page as a UTF-8 text file.
// @match        https://egy.app.spx-learning-square.com/*
// @match        *://*.spx-learning-square.com/*
// @match        *://spx-learning-square.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  var BUTTON_ID = 'qureo-sprix-export-button';
  if (document.getElementById(BUTTON_ID)) return;

  var style = document.createElement('style');
  style.textContent =
    '#' + BUTTON_ID + '{position:fixed;right:18px;bottom:18px;z-index:2147483646;' +
    'border:0;border-radius:10px;padding:11px 16px;background:#087451;color:#fff;' +
    'box-shadow:0 5px 18px #0004;font:700 14px/1.4 system-ui,sans-serif;cursor:pointer}' +
    '#' + BUTTON_ID + ':hover{background:#065f46}' +
    '#' + BUTTON_ID + ':focus-visible{outline:3px solid #facc15;outline-offset:3px}';
  (document.head || document.documentElement).appendChild(style);

  var button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.textContent = 'تصدير نص الدرس الحالي';
  button.addEventListener('click', exportCurrentLesson);
  document.body.appendChild(button);

  function notify(message) {
    button.textContent = message;
    window.setTimeout(function () {
      if (button.isConnected) button.textContent = 'تصدير نص الدرس الحالي';
    }, 2800);
  }

  function findLessonRoot() {
    return document.querySelector('main [role="main"]') ||
      document.querySelector('main') ||
      document.querySelector('[role="main"]');
  }

  function exportCurrentLesson() {
    var source = findLessonRoot();
    if (!source) {
      notify('لم أجد محتوى الدرس');
      return;
    }

    var clone = source.cloneNode(true);
    clone.querySelectorAll(
      'script,style,noscript,nav,aside,header,footer,button,[role="button"],[aria-hidden="true"]'
    ).forEach(function (element) {
      element.remove();
    });

    var lessonText = String(clone.innerText || clone.textContent || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\t ]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (lessonText.length < 100) {
      notify('النص المستخرج قصير جدًا');
      return;
    }

    var heading = clone.querySelector('h1,h2,h3,[role="heading"]');
    var title = heading ? String(heading.innerText || heading.textContent || '').trim() : '';
    var timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    var payload = (title ? title + '\n\n' : '') + lessonText + '\n';
    var blob = new Blob(['\uFEFF', payload], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'sprix-lesson-' + timestamp + '.txt';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1500);

    notify('تم تصدير ' + lessonText.length.toLocaleString('en-US') + ' حرف');
    console.info('[SPRIX Lesson Exporter] exported visible lesson text', {
      characters: lessonText.length,
      title: title
    });
  }
})();
