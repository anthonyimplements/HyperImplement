/* Nav, mobile menu, and click-to-load YouTube. No dependencies. */
(function () {
  var nav = document.getElementById('navbar');
  var hb = document.getElementById('navHamburger');
  var mm = document.getElementById('navMobileMenu');

  if (nav) {
    var onScroll = function () {
      nav.classList.toggle('scrolled', window.scrollY > 40);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  window.closeMobileMenu = function () {
    if (!mm || !hb) return;
    mm.classList.remove('open');
    hb.classList.remove('open');
    hb.setAttribute('aria-expanded', 'false');
    hb.setAttribute('aria-label', 'Open menu');
    document.body.style.overflow = '';
  };

  if (hb && mm) {
    hb.addEventListener('click', function () {
      var isOpen = mm.classList.toggle('open');
      hb.classList.toggle('open', isOpen);
      hb.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      hb.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });
    document.addEventListener('click', function (e) {
      if (!hb.contains(e.target) && !mm.contains(e.target)) closeMobileMenu();
    });
  }

  document.querySelectorAll('.yt').forEach(function (el) {
    var id = (el.getAttribute('data-yt') || '').trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return;
    var title = el.getAttribute('data-title') || 'Play video';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'yt-btn';
    btn.setAttribute('aria-label', title);
    var img = document.createElement('img');
    img.alt = '';
    img.width = 480;
    img.height = 360;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
    var play = document.createElement('span');
    play.className = 'yt-play';
    play.setAttribute('aria-hidden', 'true');
    btn.appendChild(img);
    btn.appendChild(play);
    btn.addEventListener('click', function () {
      var frame = document.createElement('iframe');
      frame.title = title;
      frame.setAttribute('allowfullscreen', '');
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1';
      el.replaceChildren(frame);
    });
    el.replaceChildren(btn);
  });
})();
