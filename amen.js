// amen.js
// Heavily based on Paul Lamere's Infinite Jukebox and remix.js by The Echo Nest.  Big hugs.
// Need to handle proper packaging for browser stuff, too!
var initializeAmen = function(context) {

    // OK, so there's a few choices here:
    // I can nest the needed functions in each public function
    // I can make other files
    // I can make other objects in this file.
    // I also have this semi-global need for the audio context, hmm.
        // I could pass it into getPlayer, as well, hmmmmm.

    // oh wow, need to make all of this speak Promises
    var amen = {
        // This function can probably just become a Promise?
        // shoudl be public!
        loadTrack: function(analysisURL, trackURL, callback) {
            var track = new Object();

            var request = new XMLHttpRequest();
            request.open('GET', analysisURL, true);
            request.onload = function() {
                if (request.status >= 200 && request.status < 400) {
                    // Success!
                    track.analysis = JSON.parse(request.responseText);
                    // TODO - figure out why our JSON is double-encoded?
                    track.analysis = JSON.parse(track.analysis);
                    track.status = 'complete';
                    amen.prepareTrack(track, trackURL, callback);
                } else {
                    // We reached our target server, but it returned an error
                }
            };
            request.onerror = function() {
                // There was a connection error of some sort
            };
            request.send();
        },


        // basically a promise, should not be public
        prepareTrack : function(track, trackURL, callback) {
            if (track.status == 'complete') {
                preprocessTrack(track);
                fetchAudio(trackURL);
            } else {
                track.status = 'error: incomplete analysis';
            }

            // Another promise. Does this have to be declared in prepareTrack?
            function fetchAudio(url) {
                var request = new XMLHttpRequest();
                trace('fetching audio ' + url);
                track.buffer = null;
                request.open('GET', url, true);
                request.responseType = 'arraybuffer';
                this.request = request;

                request.onload = function() {
                    trace('audio loading ...');
                    context.decodeAudioData(request.response,
                        function(buffer) {      // completed function
                            track.buffer = buffer;
                            track.status = 'ok';
                            callback(track, 100);
                        },
                        function(e) { // error function
                            track.status = 'error: loading audio';
                            console.log('audio error', e);
                        }
                    );
                };

                request.onerror = function(e) {
                    trace('error loading loaded', e);
                    track.status = 'error: loading audio';
                };

                request.onprogress = function(e) {
                    var percent = Math.round(e.loaded * 100 / e.total);
                    callback(track, percent);
                };

                request.send();
            } // end fetchAudio

            // not a promise - again, does this need to be created in prepareTrack?
            function preprocessTrack(track) {
                trace('preprocessTrack');
                // Eventually we will have sections, bars, and maybe tatums here
                var types = ['segments', 'beats'];

                for (var i in types) {
                    var type = types[i];
                    trace('preprocessTrack ' + type);
                    // This j might need to be a regular for loop ...
                    for (var j in track.analysis[type]) {
                        var qlist = track.analysis[type];
                        j = parseInt(j);
                        var q = qlist[j];

                        q.start = parseFloat(q.start);
                        q.duration = parseFloat(q.duration);
                        q.confidence = parseFloat(q.confidence);

                        q.loudness_max = parseFloat(q.loudness_max);
                        q.loudness_max_time = parseFloat(q.loudness_max_time);
                        q.loudness_start = parseFloat(q.loudness_start);

                        for (var k = 0; k < q.pitches.length; k++) {
                            q.pitches[k] = parseFloat(q.pitches[k]);
                        }
                        for (var m = 0; m < q.timbre.length; m++) {
                            q.timbre[m] = parseFloat(q.timbre[m]);
                        }

                        q.track = track;
                        q.which = j;

                        if (j > 0) {
                            q.prev = qlist[j-1];
                        } else {
                            q.prev = null;
                        }

                        if (j < qlist.length - 1) {
                            q.next = qlist[j+1];
                        } else {
                            q.next = null;
                        }
                    }
                }
            } // end preprocessTrack
        },

        // not a promise, should for sure be public 
        getPlayer : function(effects) {
            var queueTime = 0;
            var audioGain = context.createGain();
            var currentlyQueued = new Array();
            var onPlayCallback = null;
            var afterPlayCallback = null;
            var currentTriggers = new Array();
            audioGain.gain.value = 1;

            // Connect effects
            effects = effects || [];
            effects.unshift(audioGain);
            for (var i = 0; i < effects.length -1; i++) {
                effects[i].connect(effects[i + 1]);
            }
            effects[i].connect(context.destination);

            // so it looks like the style is for each top-level function to declare it's own sub-functions?
            function queuePlay(when, q) {
                audioGain.gain.value = 1;
                var theTime = context.currentTime;
                // why in heaven's name do I have three ways of playing?
                // I am sure there was a good reason for this, but man
                if (isAudioBuffer(q)) {
                    var audioSource = context.createBufferSource();
                    audioSource.buffer = q;
                    audioSource.connect(audioGain);
                    currentlyQueued.push(audioSource);
                    audioSource.start(when);

                    if (onPlayCallback != null) {
                        theTime = (when - context.currentTime) *  1000;
                        currentTriggers.push(setTimeout(onPlayCallback, theTime));
                    }

                    if (afterPlayCallback != null) {
                        theTime = (when - context.currentTime + parseFloat(q.duration)) *  1000;
                        currentTriggers.push(setTimeout(afterPlayCallback, theTime));
                    }

                    return when + parseFloat(q.duration);

                } else if (Array.isArray(q)) {
                    // Correct for load times
                    if (when == 0) {
                        when = context.currentTime;
                    }
                    for (var i = 0; i < q.length; i++) {
                        when = queuePlay(when, q[i]);
                    }
                    return when;
                } else if (isQuantum(q)) {
                    var audioQuantumSource = context.createBufferSource();
                    audioQuantumSource.buffer = q.track.buffer;
                    audioQuantumSource.connect(audioGain);
                    q.audioQuantumSource = audioQuantumSource;
                    currentlyQueued.push(audioQuantumSource);
                    audioQuantumSource.start(when, q.start, q.duration);

                    // I need to clean up all these ifs
                    if ('syncBuffer' in q) {
                        var audioSyncSource = context.createBufferSource();
                        audioSyncSource.buffer = q.syncBuffer;
                        audioSyncSource.connect(audioGain);
                        currentlyQueued.push(audioSyncSource);
                        audioSyncSource.start(when);
                    }

                    if (onPlayCallback != null) {
                        theTime = (when - context.currentTime) *  1000;
                        currentTriggers.push(setTimeout(onPlayCallback, theTime));
                    }
                    if (afterPlayCallback != null) {
                        theTime = (when - context.currentTime + parseFloat(q.duration)) *  1000;
                        currentTriggers.push(setTimeout(afterPlayCallback, theTime));
                    }
                    return (when + parseFloat(q.duration));
                }
                else if (isSilence(q)) {
                    return (when + parseFloat(q.duration));
                }
                else {
                    error('cannot play ' + q);
                    return when;
                }
            } // end play


            // the actual player object that we get
            var player = {
                play: function(when, q) {
                    return queuePlay(when, q);
                },

                addOnPlayCallback: function(callback) {
                    onPlayCallback = callback;
                },

                addAfterPlayCallback: function(callback) {
                    afterPlayCallback = callback;
                },

                queue: function(q) {
                    var now = context.currentTime;
                    if (now > queueTime) {
                        queueTime = now;
                    }
                    queueTime = queuePlay(queueTime, q);
                },

                queueRest: function(duration) {
                    queueTime += duration;
                },

                stop: function() {
                    for (var i = 0; i < currentlyQueued.length; i++) {
                        if (currentlyQueued[i] != null) {
                            currentlyQueued[i].stop();
                        }
                    }
                    currentlyQueued = new Array();

                    if (currentTriggers.length > 0) {
                        for (var j = 0; j < currentTriggers.length; j++) {
                            clearTimeout(currentTriggers[j]);
                        }
                        currentTriggers = new Array();
                    }
                },

                curTime: function() {
                    return context.currentTime;
                },
            }; // end player

            return player;
        },
    }; // end amen

    // These ones are small and easy to test - but where are they used / where should they go?
    // Let's move these small ones into Player, but make trace / error global?
    // We can make error() call error, I tell you what


    // ah, these are global-to-this-module, but are also privte!
    // yeah, let's move shit here, I think?
    // is it too too tacky to move all child functions of LOADING here, 
    // and then put a BIG COMMENT and move all child functions of the playe here?
    // I think this is fine, I will do it tomorrow

   // used in Player
    function isQuantum(a) {
        return 'start' in a && 'duration' in a;
    }

    // used in Player
    function isAudioBuffer(a) {
        return 'getChannelData' in a;
    }

    // used in Player
    function isSilence(a) {
        return 'isSilence' in a;
    }

    function trace(text) {
        console.log(text);
    }

    function error(s) {
        console.log(s);
    }

    return amen;
};

exports.amen = initializeAmen;
