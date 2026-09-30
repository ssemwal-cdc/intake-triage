(function(){
  // submitRequest(payload) -> Promise. Empty token: local preview adapter (console.log + resolve).
  // Token set: PUT the payload as JSON to the submissions repo via the GitHub contents API.
  function slug(s){
    return (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'request';
  }
  function randChars(n){
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789', out = '';
    for (var i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }
  function utf8ToB64(str){
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    bytes.forEach(function(b){ bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  window.submitRequest = function(payload){
    var cfg = window.INTAKE_CONFIG || {};
    if (!cfg.token) {
      return new Promise(function(resolve){
        console.log(payload);
        resolve();
      });
    }
    var date = payload.submittedAt.slice(0, 10);
    var path = 'submissions/' + date + '-' + slug(payload.shortName) + '-' + randChars(6) + '.json';
    var json = JSON.stringify(payload, null, 2);
    var url = 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo + '/contents/' + path;
    return fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + cfg.token,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Add request: ' + payload.shortName,
        content: utf8ToB64(json),
        branch: cfg.branch
      })
    }).then(function(res){
      if (!res.ok) {
        return res.text().then(function(t){
          throw new Error('GitHub API error ' + res.status + (t ? ': ' + t : ''));
        });
      }
    });
  };
})();
