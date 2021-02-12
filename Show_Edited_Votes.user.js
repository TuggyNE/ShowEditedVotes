// ==UserScript==
// @name        Show Edited Votes
// @namespace   com.tuggy.nathan
// @description Displays a list of posts that have been edited since voting
// @include     /^https?:\/\/(?:meta\.)?(?:stackoverflow|stackapps|askubuntu|serverfault|superuser|[^\/\.]+\.stackexchange)\.com\/users\/\d+\/.*\?tab=votes/
// @version     1.5.00
// @grant       none
// ==/UserScript==//
// Throttling implementation borrowed from rene's Match Against Peers In Review

function parseIsoDatetime(dtstr) {      // From http://stackoverflow.com/a/26434619
  var dt = dtstr.split(/[: T-]/).map(parseFloat);
  return new Date(dt[0], dt[1] - 1, dt[2], dt[3] || 0, dt[4] || 0, dt[5] || 0, 0);
}

function parseInt(str) {
  return Number.parseInt(str.replace(",", ""));
}

(function ($, window) {
  "use strict";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var tasks = [],
      intervalTime = 200, // milliseconds (make this larger when throttled often)
      per = 90000,        // milliseconds
      penalty = 60000,    // milliseconds to wait after 503
      rate = 150,         // per 90000 milliseconds (make this smaller when throttled often, but on 80 you're safe)
      interval,
      handler,
      ids = [],
      lastVoted = [],
      voteTypes = [],
      filters = $('.subtabs.user-tab-sorts').first(),
      table = $('.history-table > tbody').first(),
      editedFilter = $('<a href="#">edited since voting</a>'),
      idCurrentUser = new Number(/\/(\d+)\//.exec(document.location.href)[1]),
      counter = $('h1 > span.count').first(),
      progress = $('<img src="/content/img/progress-dots.gif"></img>'),
      state = "start",
      voteAddPendingCounter,
      currentFilterText = $('.user-tab-sorts > a.youarehere').first().text().trim(),
      includeDown = currentFilterText != "upvote",
      includeUp = currentFilterText != "downvote";

  // Add first page of given vote type
  function addFirstPage(voteType) {
    var urlBase = document.location.href.replace(/&sort=.*$/, ''), urlFirst = urlBase + '&sort=' + voteType;
    state = voteType;
    handler = addPages.bind(urlFirst);
    voteAddPendingCounter = 0;
    tasks.push(urlFirst);
  }
  
  // For each page of the type from the page given, put a task in the queue
  function addPages(docFirst) {
    var urlFirst = this,
        maxPage = parseInt($('a:not([rel=next]) > span.page-numbers', docFirst).last().text());
    pageHandler(docFirst);
    state += '-paging';
    handler = pageHandler;
    for (let i = 2; i <= maxPage; i++) {
      tasks.push(urlFirst + '&page=' + i);
    }
  }
  
  // For each 100 post IDs, put a task in the queue, doing preliminary filtering by the earliest of those posts' vote dates
  function addAPICalls() {
    const methodBase = 'https://api.stackexchange.com/2.2/posts/',
          paramBaseA = '?pagesize=100&order=desc&key=V8Sw6puqD0eUqphKLGadPw((&min=',
          paramBaseB = '&sort=activity&filter=!)4k-FmSEkrkChRkSHXPXHE2SxOhY&site=',
          sitePattern = /(?:meta\.)?(?:[^\.\/]+(?=\.stackexchange)|stackoverflow|stackapps|askubuntu|serverfault|superuser)/;
    var siteMatch = sitePattern.exec(document.location.hostname), siteParam;
    state = "API-calling";
    handler = apiHandler;
    if (siteMatch) {
      siteParam = siteMatch[0];
    }
    else {
      alert("Show Edited Votes: Couldn't find site abbreviation in URL! ('" + document.location.hostname + "')");
      return;
    }
    while (ids.length > 0) {
      let paramIDs = ids.slice(0, 100), idParam = paramIDs.join(';');
      let minParam = paramIDs.map(function (e) {
          return new Number(lastVoted[e]);
        }).reduce(function (a, b) {
            return Math.min(a, b);
          }, Date.now() / 1000);
      let url = methodBase + idParam + paramBaseA + minParam + paramBaseB + siteParam;
      tasks.push(url);
      ids = ids.slice(100);
    }
  }

  function pageHandler(data) {
    // Grab post TDs
    var posts = $('td.async-load', data), noVote = [], voteType = state.split('-')[0];
    for (let i = 0; i < posts.length; i++) {
      let id = new Number(posts[i].id.replace('enable-load-body-', ''));
      let voted = $(posts[i]).parent().find('.date_brick[title], .date[title]')[0].title;
      if (voted) {
        ids.push(id);
        lastVoted[id] = parseIsoDatetime(voted).valueOf() / 1000;
        voteTypes[id] = voteType;
      }
      else {
        noVote.push(id);
      }
    }
    if (noVote.length > 0) {
      alert("Show Edited Votes: Posts " + noVote.join(", ") + " have no vote date!");
    }
  }
  function apiHandler(data) {
    const spanDownvote = '<span style="color:maroon;">downvote</span>',
          spanUpvote   = '<span style="color:green ;">  upvote</span>';
    if (data.backoff) {
      alert("Show Edited Votes: Backing off for " + data.backoff + " seconds");
      setThrottle(Date.now() + data.backoff);
      return;
    }
    
    var modified = [];
    if (data.items) {
      modified = data.items.filter(function (item) {
        return item.last_edit_date && item.last_editor &&
               new Number(item.last_edit_date) > lastVoted[item.post_id] &&
               item.last_editor.user_id != idCurrentUser;
      });
    }
    // Add to visible list
    // TODO: Sort by date before vote type
    modified.forEach(function (item) {
        let date = new Date(lastVoted[item.post_id] * 1000);
        // TODO: Add edited date to display
        table.append('<tr><td><div class="date_brick" title="' + 
            date.toLocaleString() + 
            '">' + 
            months[date.getMonth()] + " " + date.getDate() +
            '</div></td><td>' +
            ('downvote' == voteTypes[item.post_id] ? spanDownvote : spanUpvote) +
            '</td><td><b><a href="' +
            item.link +
            '" class="answer-hyperlink timeline-answers">' +
            item.title +
            '</a></b></td></tr>');
      });
    counter.text(parseInt(counter.text()) + modified.length);
    
    if (0 === data.quota_remaining) {
      alert("Show Edited Votes: Out of quota!");
      window.clearInterval(interval);   // Drop the rest on the floor
      // TODO? Set date flag to not even try until tomorrow
    }
  }

  // get array with timestamps from localstorage
  function getThrottle() {
    var calls = window.localStorage.getItem('se-throttle');
    if (calls === null) {
      calls = [ Date.now() ];
    } else {
      calls = JSON.parse(calls);
      if (!Array.isArray(calls)) {
          calls = [ Date.now() ];
      }
    }
    return calls;
  }
  
  // update timestamp array for throttle
  function setThrottle(time) {
    var calls = getThrottle(),
        i;
    
    if (time === undefined) {
        time = Date.now();
    }
    for (i = 0; ((i < calls.length - 1) && (calls[0] < Date.now() - per)); i++) {
      calls.shift();
    }
    if (calls.length > rate) {
      calls.shift();
    }
    calls.push(time); 
    window.localStorage.setItem('se-throttle', JSON.stringify(calls));
  }
  
  // gets called by the setInterval
  function taskWorker() {
    var url = tasks.shift(), jqXHR;

    if (url) {
      $.get(url)
        .done(function (data) { 
          setThrottle();
          handler(data); 
        })
        .fail(function (xhr, stat, error) {
          // Service Unavailable means we're throttled, panic
          //console.log(xhr);
          if (xhr.status === 503) {
            // wait a full minute to get free
            setThrottle(Date.now() + penalty); 
          }
        });
    }
    else {
      // current state empty, what's next?
      switch (state) {
        case "upvote-paging":
          setThrottle(); 
          if (includeDown) {
            addFirstPage("downvote");
            break;
          }
          // otherwise, fall through
        case "downvote-paging":
          // API calls, if there's anything to do
          if (ids.length > 0) {
            setThrottle(); 
            addAPICalls();
            break;
          }
        case "upvote":
        case "downvote":
          if (voteAddPendingCounter < 10) {
            voteAddPendingCounter++;
            break;
          }
          // fall through
        default: 
          // nothing left to do
          progress.hide();
          setThrottle(); 
          window.clearInterval(interval);
          if ("API-calling" != state) alert("Show Edited Votes: Finished '" + state + "' state unexpectedly");
      }
    }
  }
  
  // check if we are within the throttle boundaries
  function isAllowed() {
    var calls = getThrottle(),
        timepassed;
       
    timepassed = Date.now() - calls[0];
    //console.log(timepassed);
    return (((calls.length < rate) || 
           (timepassed > per)) && 
           (calls[calls.length-1] < Date.now()));
  }
  
  // handle a task
  function task() {
    if (isAllowed()) {
      taskWorker();
    } else {
      //console.log('<< throttle >>');
    }
  }
  
  editedFilter.click(function () {
    filters.find('.youarehere').removeClass('youarehere');
    editedFilter.addClass('youarehere');
    counter.parent().html('<span class="count">0</span> Edits Since Votes Cast');
    counter = $('h1 > span.count').first();
    table.empty();
    $('.pager').remove();
    progress.show();
    
    if (includeUp) {
      addFirstPage("upvote");
    }
    else {
      addFirstPage("downvote");
    }
    interval = window.setInterval(task, intervalTime);
    return false;
  });
  
  editedFilter.append(progress);
  progress.css('margin-left', '0.5em');
  progress.hide();
  filters.prepend(editedFilter);
}($ || unsafeWindow.$, window || unsafeWindow));
  