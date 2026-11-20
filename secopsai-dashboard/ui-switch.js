// Opt-in preview of the redesigned console stylesheet.
// ?ui=next turns it on for this browser, ?ui=classic turns it off.
(function () {
  var KEY = 'secopsai-ui';
  var BUILD = '3';
  try {
    var param = new URLSearchParams(window.location.search).get('ui');
    if (param === 'next') window.localStorage.setItem(KEY, 'next');
    if (param === 'classic') window.localStorage.removeItem(KEY);
    if (window.localStorage.getItem(KEY) !== 'next') return;
  } catch (error) {
    return;
  }
  var link = document.getElementById('console-stylesheet');
  if (link) link.href = link.href.replace('styles.css', 'styles.next.css') + '-n' + BUILD;
  document.documentElement.setAttribute('data-ui', 'next');
}());
