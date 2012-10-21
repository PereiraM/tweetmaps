/**
 *
 * Torque library
 * 
 * A tool for mapping temporal data from CartoDB
 * Still in development and being finalized for
 * CartoDB 2.0
 *
 * Authors: Andrew Hill, Simon Tokumine, Javier Santana
 *
 */

// iOS fix
if (Function.prototype.bind == undefined) {
    Function.prototype.bind = function (bind) {
        var self = this;
        return function () {
            var args = Array.prototype.slice.call(arguments);
            return self.apply(bind || null, args);
        };
    };
}

function Torque() {
    var args = Array.prototype.slice.call(arguments),
        callback = args.pop(),
        modules = (args[0] && typeof args[0] === "string") ? args : args[0],
        config,
        i;
    
    if (!(this instanceof Torque)) {
        return new Torque(modules, callback);
    }

    if (!modules || modules === '*') {
        modules = [];
        for (i in Torque.modules) {
            if (Torque.modules.hasOwnProperty(i)) {
                modules.push(i);
            }
        }
    }

    for (i = 0; i < modules.length; i += 1) {
        Torque.modules[modules[i]](this);
    }

    callback(this);
    return this;
};

Torque.modules = {};

Torque.modules.app = function (torque) {
    torque.app = {};
    torque.app.Instance = Class.extend(
        {
            init:function (logging) {
                this.layers = {};
                torque.log.enabled = logging ? logging : false;
            },
            addLayer:function (map, options) {
                var layer = new torque.layer.Engine(map, options);
                return layer
            }
        }
    );
};

Torque.modules.layer = function (torque) {
    torque.layer = {};
    torque.layer.Engine = Class.extend({
        init:function (map, options) {
            this._defaults = {
                user:'viz2',
                table:'ny_bus',
                column:'timestamp',
                steps:250,
                resolution:3,
                cumulative:false,
                fps:24,
                autoplay:true,
                clock:false,
                zindex:0,
                fitbounds:false,
                countby:'count(i.obama)',
                countby2:'count(i.romney)',
                blendmode:'source-over',
                trails:false,
                point_type:'square',
                subtitles:false
            }
            this.options = _.defaults(options, this._defaults);

            this._map = map;
            this._index = this.options.zindex;

            while (this._map.overlayMapTypes.length < this.options.zindex) {
                this._map.overlayMapTypes.push(null);
            }

            this._cartodb = new Backbone.CartoDB({user:this.options.user});
            this.bounds = new google.maps.LatLngBounds();

            torque.clock.enabled = this.options.clock ? this.options.clock : false;
            torque.clock.set('loading...');

            this.getDeltas();
        },
        pause:function () {
            if (this.running == true) {
                this.running = false;
            } else {
                this.running = true;
                this.play();
            }
        },
        setOptions:function (new_options) {

            this.running = false;
            this.options = _.defaults(new_options, this._defaults);

            torque.clock.enabled = this.options.clock ? this.options.clock : false;
            torque.clock.set('loading...');

            this._cartodb = new Backbone.CartoDB({user:this.options.user});
            this.bounds = new google.maps.LatLngBounds();

            this._map.overlayMapTypes.setAt(this._index, null);
            this.getDeltas();
        },
        run:function () {
            this.start = new Date(this.options.start).getTime();
            this.end = new Date(this.options.end).getTime();

            this._current = this.start;
            this._step = Math.floor((this.end - this.start) / this.options.steps);

            this._setupListeners();

            this._display = new TimePlayer(this.start, (this.start - this.end), this._step, this.options);

            this._map.overlayMapTypes.setAt(this._index, this._display);

            this.fitBounds(this.options.fitbounds);

            this.running = false;
            torque.clock.clear();

            if (this.options.autoplay) {
                this.running = true;
                this.play();
            }

            torque.log.info('Layer is now running!');
        },
        _setupListeners:function () {
            var that = this;
            google.maps.event.addListener(this._map, 'zoom_changed', function () {
                that._display.reset_max_value();
            });
        },
        getBounds:function () {
            return this.bounds;
        },
        fitBounds:function (f) {
            if (f !== false) {
                this._map.fitBounds(this.bounds);
                if (typeof f == 'number') {
                    this._map.setZoom(this._map.getZoom() + f);
                } else {
                    this._map.setZoom(this._map.getZoom());
                }
            }
        },
        getDeltas:function (options) {
            var that = this;
            var sql = "SELECT st_xmax(st_envelope(st_collect(the_geom))) xmax,st_ymax(st_envelope(st_collect(the_geom))) ymax, st_xmin(st_envelope(st_collect(the_geom))) xmin, st_ymin(st_envelope(st_collect(the_geom))) ymin, date_part('epoch',max({0})) max, date_part('epoch',min({0})) min FROM {1}".format(this.options.column, this.options.table);

            var timeExtents = this._cartodb.CartoDBCollection.extend({
                sql:sql
            });
            var times = new timeExtents();
            times.fetch();
            times.bind('reset', function () {
                times.each(function (p) {
                    that.options.start = p.get('min');
                    that.options.end = p.get('max');
                    that.bounds.extend(new google.maps.LatLng(p.get('ymin'), p.get('xmax')));
                    that.bounds.extend(new google.maps.LatLng(p.get('ymax'), p.get('xmin')));
                    that.bounds.extend(new google.maps.LatLng((p.get('ymax') + p.get('ymin')) / 2, (p.get('xmax') + p.get('xmin')) / 2));
                });
                that.run();
            });
        },
        advance:function () {
            if (this._current < this.end) {
                this._current = this._current + this._step
            } else {
                this._current = this.start;
            }
            this._display.set_time((this._current - this.start) / this._step);
        },
        play:function () {
            var pause = 0;
            if (this._current < this.end) {
                this._current = this._current + this._step
                if (this.end < this._current) {
                    pause = 2500;
                }
            } else {
                this._current = this.start;
            }

            var date = new Date(this._current * 1000);
            
            //var date_arry = date.toString().substr(4).split(' ');
            //torque.clock.set('<span id="month">' + date_arry[0] + '</span> <span id="year">' + date_arry[2] + '</span>');
            torque.clock.set(date.toString());

            if (this.options.subtitles) {
                torque.subtitles.set(date);
            }

            this._display.set_time((this._current - this.start) / this._step);

            if (this.running) {
                setTimeout(function () {
                    this.play()
                }.bind(this), pause + 1000 * 1 / this.options.fps);
            }
        }
    });
}

Torque.modules.clock = function (torque) {
    torque.clock = {};

    torque.clock.clear = function () {
        $('.torque_time').html('');
    };
    torque.clock.set = function (msg) {
        torque.clock._hand(msg);
    };
    torque.clock._hand = function (msg) {
        var clockger = window.console;
        if (torque.clock.enabled) {
            $('.torque_time').html(msg);
        }
    };
};

Torque.modules.subtitles = function (torque) {
    torque.subtitles = {
  "subs": [
    {
      "from": "2012-10-04T09:03:00-05:00",
      "speaker": null,
      "sub": "",
      "to": "2012-10-04T09:03:01-05:00"
    },
    {
      "from": "2012-10-04T09:03:01-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Good evening from the Magness Arena at the University of Denver in Denver, Colorado. I'm Jim Lehrer of the PBS NewsHour, and I welcome you to the first of the 2012 presidential debates between President Barack Obama, the Democratic nominee, and former Massachusetts Governor Mitt Romney, the Republican nominee.</p>\n    </div>",
      "to": "2012-10-04T09:03:22-05:00"
    },
    {
      "from": "2012-10-04T09:03:22-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>This debate and the next three -- two presidential, one vice- presidential -- are sponsored by the Commission on Presidential Debates.</p>\n    </div>",
      "to": "2012-10-04T09:03:31-05:00"
    },
    {
      "from": "2012-10-04T09:03:31-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Tonight's 90 minutes will be about domestic issues, and will follow a format designed by the commission. There will be six roughly 15-minute segments, with two-minute answers for the first question, then open discussion for the remainder of each segment.</p>\n    </div>",
      "to": "2012-10-04T09:03:50-05:00"
    },
    {
      "from": "2012-10-04T09:03:50-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Thousands of people offered suggestions on segment subjects of questions via the Internet and other means, but I made the final selections, and for the record, they were not submitted for approval to the commission or the candidates.</p>\n    </div>",
      "to": "2012-10-04T09:04:06-05:00"
    },
    {
      "from": "2012-10-04T09:04:06-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>The segments, as I announced in advance, will be three on the economy and one each on health care, the role of government, and governing, with an emphasis throughout on differences, specifics and choices. Both candidates will also have two-minute closing statements.</p>\n    </div>",
      "to": "2012-10-04T09:04:27-05:00"
    },
    {
      "from": "2012-10-04T09:04:27-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>The audience here in the hall has promised to remain silent. No cheers, applause, boos, hisses -- among other noisy distracting things -- so we may all concentrate on what the candidates have to say. There is a noise exception right now, though, as we welcome President Obama and Governor Romney. (Cheers, applause.)</p>\n    </div>",
      "to": "2012-10-04T09:05:17-05:00"
    },
    {
      "from": "2012-10-04T09:05:17-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Gentlemen, welcome to you both.</p>\n    </div>",
      "to": "2012-10-04T09:05:20-05:00"
    },
    {
      "from": "2012-10-04T09:05:20-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let's start the economy, segment one. And let's begin with jobs. What are the major differences between the two of you about how you would go about creating new jobs? You have two minutes -- each of you have two minutes to start. The coin toss has determined, Mr. President, you go first.</p>\n    </div>",
      "to": "2012-10-04T09:05:44-05:00"
    },
    {
      "from": "2012-10-04T09:05:44-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, thank you very much, Jim, for this opportunity. I want to thank Governor Romney and the University of Denver for your hospitality.</p>\n    </div>",
      "to": "2012-10-04T09:05:50-05:00"
    },
    {
      "from": "2012-10-04T09:05:50-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>There are a lot of points that I want to make tonight, but the most important one is that 20 years ago I became the luckiest man on earth because Michelle Obama agreed to marry me. (Laughter.) And so I just want to wish, Sweetie, you happy anniversary and let you know that a year from now, we will not be celebrating it in front of 40 million people. (Laughter.)</p>\n    </div>",
      "to": "2012-10-04T09:06:13-05:00"
    },
    {
      "from": "2012-10-04T09:06:13-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>You know, four years ago we went through the worst financial crisis since the Great Depression. Millions of jobs were lost. The auto industry was on the brink of collapse. The financial system had frozen up. And because of the resilience and the determination of the American people, we've begun to fight our way back.</p>\n    </div>",
      "to": "2012-10-04T09:06:33-05:00"
    },
    {
      "from": "2012-10-04T09:06:33-05:00",
      "speaker": null,
      "sub": "",
      "to": "2012-10-04T09:06:33-05:00"
    },
    {
      "from": "2012-10-04T09:06:33-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p><span>Over the last 30 months, we've seen 5 million jobs in the private sector created.</span> The auto industry has come roaring back and housing has begun to rise. But we all know that we've still got a lot of work to do. And so the question here tonight is not where we've been but where we're going. Governor Romney has a perspective that says if we cut taxes, skewed towards the wealthy, and roll back regulations that we'll be better off.</p>\n    </div>",
      "to": "2012-10-04T09:07:04-05:00"
    },
    {
      "from": "2012-10-04T09:07:04-05:00",
      "speaker": null,
      "sub": "",
      "to": "2012-10-04T09:07:04-05:00"
    },
    {
      "from": "2012-10-04T09:07:04-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>I've got a different view. I think we've got to invest in education and training. I think it's important for us to develop new sources of energy here in America, that we change our tax code to make sure that we're helping small businesses and companies that are investing here in the United States, that <span>we take some of the money that we're saving as we wind down two wars to rebuild America and that we reduce our deficit in a balanced way that allows us to make these critical investments</span>.</p>\n    </div>",
      "to": "2012-10-04T09:07:31-05:00"
    },
    {
      "from": "2012-10-04T09:07:31-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Now, it ultimately is going to be up to the voters, to you, which path we should take. Are we going to double down on the top-down economic policies that helped to get us into this mess, or do we embrace a new economic patriotism that says, America does best when the middle class does best? And I'm looking forward to having that debate.</p>\n    </div>",
      "to": "2012-10-04T09:07:50-05:00"
    },
    {
      "from": "2012-10-04T09:07:50-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Governor Romney, two minutes.</p>\n    </div>",
      "to": "2012-10-04T09:07:52-05:00"
    },
    {
      "from": "2012-10-04T09:07:52-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Thank you, Jim. It's an honor to be here with you, and I appreciate the chance to be with the president. I am pleased to be at the University of Denver, appreciate their welcome and also the presidential commission on these debates.</p>\n    </div>",
      "to": "2012-10-04T09:08:03-05:00"
    },
    {
      "from": "2012-10-04T09:08:03-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And congratulations to you, Mr. President, on your anniversary. I'm sure this was the most romantic place you could imagine here -- here with me, so I -- (laughter) -- congratulations.</p>\n    </div>",
      "to": "2012-10-04T09:08:13-05:00"
    },
    {
      "from": "2012-10-04T09:08:13-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>This is obviously a very tender topic. I've had the occasion over the last couple of years of meeting people across the country. I was in Dayton, Ohio, and a woman grabbed my arm, and she said, I've been out of work since May. Can you help me?</p>\n    </div>",
      "to": "2012-10-04T09:08:26-05:00"
    },
    {
      "from": "2012-10-04T09:08:26-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Ann yesterday was a rally in Denver, and a woman came up to her with a baby in her arms and said, Ann, my husband has had four jobs in three years, part-time jobs. He's lost his most recent job, and we've now just lost our home. Can you help us?</p>\n    </div>",
      "to": "2012-10-04T09:08:42-05:00"
    },
    {
      "from": "2012-10-04T09:08:42-05:00",
      "speaker": null,
      "sub": "",
      "to": "2012-10-04T09:08:42-05:00"
    },
    {
      "from": "2012-10-04T09:08:42-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And the answer is yes, we can help, but it's going to take a different path, not the one we've been on, <span>not the one the president describes as a top-down, cut taxes for the rich. That's not what I'm going to do.</span></p>\n    </div>",
      "to": "2012-10-04T09:08:55-05:00"
    },
    {
      "from": "2012-10-04T09:08:55-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>My plan has five basic parts. One, get us energy independent, North American energy independent. That creates about four million jobs. Number two, open up more trade, particularly in Latin America; crack down on China if and when they cheat. Number three, make sure our people have the skills they need to succeed and the best schools in the world. We're far away from that now. Number four, get us to a balanced budget. Number five, champion small business.</p>\n    </div>",
      "to": "2012-10-04T09:09:21-05:00"
    },
    {
      "from": "2012-10-04T09:09:21-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>It's small business that creates the jobs in America. And over the last four years small-business people have decided that America may not be the place to open a new business, because new business startups are down to a 30-year low. I know what it takes to get small business growing again, to hire people.</p>\n    </div>",
      "to": "2012-10-04T09:09:38-05:00"
    },
    {
      "from": "2012-10-04T09:09:38-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Now, I'm concerned that the path that we're on has just been unsuccessful. The president has a view very similar to the view he had when he ran four years ago, that a bigger government, spending more, taxing more, regulating more -- if you will, trickle-down government would work. That's not the right answer for America. I'll restore the vitality that gets America working again.</p>\n    </div>",
      "to": "2012-10-04T09:09:59-05:00"
    },
    {
      "from": "2012-10-04T09:09:59-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Thank you.</p>\n    </div>",
      "to": "2012-10-04T09:10:00-05:00"
    },
    {
      "from": "2012-10-04T09:10:00-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Mr. President, please respond directly to what the governor just said about trickle-down -- his trickle-down approach. He's -- as he said yours is.</p>\n    </div>",
      "to": "2012-10-04T09:10:10-05:00"
    },
    {
      "from": "2012-10-04T09:10:10-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, let me talk specifically about what I think we need to do.</p>\n    </div>",
      "to": "2012-10-04T09:10:15-05:00"
    },
    {
      "from": "2012-10-04T09:10:15-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>First, we've got to improve our education system. And we've made enormous progress drawing on ideas both from Democrats and Republicans that are already starting to show gains in some of the toughest-to- deal-with schools. We've got a program called Race to the Top that has prompted reforms in 46 states around the country, raising standards, improving how we train teachers. So now I want to hire another hundred thousand new math and science teachers and create 2 million more slots in our community colleges so that people can get trained for the jobs that are out there right now. And I want to make sure that we keep tuition low for our young people.</p>\n    </div>",
      "to": "2012-10-04T09:10:55-05:00"
    },
    {
      "from": "2012-10-04T09:10:55-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>When it comes to our tax code, Governor Romney and I both agree that our corporate tax rate is too high. So I want to lower it, particularly for manufacturing, taking it down to 25 percent. But I also want to close those loopholes that are giving incentives for companies that are shipping jobs overseas. I want to provide tax breaks for companies that are investing here in the United States.</p>\n    </div>",
      "to": "2012-10-04T09:11:18-05:00"
    },
    {
      "from": "2012-10-04T09:11:18-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>On energy, Governor Romney and I, we both agree that we've got to boost American energy production.</p>\n    </div>",
      "to": "2012-10-04T09:11:25-05:00"
    },
    {
      "from": "2012-10-04T09:11:25-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And oil and natural gas production are higher than they've been in years. But I also believe that we've got to look at the energy source of the future, like wind and solar and biofuels, and make those investments.</p>\n    </div>",
      "to": "2012-10-04T09:11:38-05:00"
    },
    {
      "from": "2012-10-04T09:11:38-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>So, all of this is possible. Now, in order for us to do it, we do have to close our deficit, and one of the things I'm sure we'll be discussing tonight is, how do we deal with our tax code, and how do we make sure that we are reducing spending in a responsible way, but also how do we have enough revenue to make those investments? And this is where there's a difference because Governor Romney's central economic plan calls for a $5 trillion tax cut, on top of the extension of the Bush tax cuts, so that's another $2 trillion, and $2 trillion in additional military spending that the military hasn't asked for. That's $8 trillion. How we pay for that, reduce the deficit and make the investments that we need to make without dumping those costs on the middle-class Americans I think is one of the central questions of this campaign.</p>\n    </div>",
      "to": "2012-10-04T09:12:23-05:00"
    },
    {
      "from": "2012-10-04T09:12:23-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Both of you have spoken about a lot of different things, and we're going to try to get through them in as specific a way as we possibly can.</p>\n    </div>",
      "to": "2012-10-04T09:12:31-05:00"
    },
    {
      "from": "2012-10-04T09:12:31-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But first, Governor Romney, do you have a question that you'd like to ask the president directly about something he just said?</p>\n    </div>",
      "to": "2012-10-04T09:12:37-05:00"
    },
    {
      "from": "2012-10-04T09:12:37-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, sure. I'd like to clear up the record and go through it piece by piece. First of all, I don't have a $5 trillion tax cut. I don't have a tax cut of a scale that you're talking about. My view is that we ought to provide tax relief to people in the middle class. But I'm not going to reduce the share of taxes paid by high- income people. High-income people are doing just fine in this economy. They'll do fine whether you're president or I am.</p>\n    </div>",
      "to": "2012-10-04T09:12:58-05:00"
    },
    {
      "from": "2012-10-04T09:12:58-05:00",
      "speaker": null,
      "sub": "",
      "to": "2012-10-04T09:12:58-05:00"
    },
    {
      "from": "2012-10-04T09:12:58-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>The people who are having the hard time right now are middle- income Americans. Under the president's policies, middle-income Americans have been buried. They're -- they're just being crushed. <span>Middle-income Americans have seen their income come down by $4,300.</span> This is a -- this is a tax in and of itself. I'll call it the economy tax. It's been crushing. The same time, gasoline prices have doubled under the president, electric rates are up, food prices are up, health care costs have gone up by $2,500 a family.</p>\n    </div>",
      "to": "2012-10-04T09:13:28-05:00"
    },
    {
      "from": "2012-10-04T09:13:28-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Middle-income families are being crushed. And so the question is how to get them going again, and I've described it. It's energy and trade, the right kind of training programs, balancing our budget and helping small business. Those are the -- the cornerstones of my plan.</p>\n    </div>",
      "to": "2012-10-04T09:13:42-05:00"
    },
    {
      "from": "2012-10-04T09:13:42-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But the president mentioned a couple of other ideas, and I'll just note: first, education. I agree, education is key, particularly the future of our economy. But our training programs right now, we got 47 of them housed in the federal government, reporting to eight different agencies. Overhead is overwhelming. We got to get those dollars back to the states and go to the workers so they can create their own pathways to getting the training they need for jobs that will really help them.</p>\n    </div>",
      "to": "2012-10-04T09:14:07-05:00"
    },
    {
      "from": "2012-10-04T09:14:07-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>The second area: taxation. We agree; we ought to bring the tax rates down, and I do, both for corporations and for individuals. But in order for us not to lose revenue, have the government run out of money, I also lower deductions and credits and exemptions so that we keep taking in the same money when you also account for growth.</p>\n    </div>",
      "to": "2012-10-04T09:14:24-05:00"
    },
    {
      "from": "2012-10-04T09:14:24-05:00",
      "speaker": null,
      "sub": "",
      "to": "2012-10-04T09:14:24-05:00"
    },
    {
      "from": "2012-10-04T09:14:24-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>The third area: energy. Energy is critical, and the president pointed out correctly that <span>production of oil and gas in the U.S. is up. But not due to his policies. In spite of his policies. Mr. President, all of the increase in natural gas and oil has happened on private land, not on government land.</span> On government land, your administration has cut the number of permits and license in half. If I'm president, I'll double them. And also get the -- the oil from offshore and Alaska. And I'll bring that pipeline in from Canada.</p>\n    </div>",
      "to": "2012-10-04T09:14:57-05:00"
    },
    {
      "from": "2012-10-04T09:14:57-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And by the way, I like coal. I'm going to make sure we continue to burn clean coal. People in the coal industry feel like it's getting crushed by your policies. I want to get America and North America energy independent, so we can create those jobs.</p>\n    </div>",
      "to": "2012-10-04T09:15:11-05:00"
    },
    {
      "from": "2012-10-04T09:15:11-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And finally, with regards to that tax cut, look, I'm not looking to cut massive taxes and to reduce the -- the revenues going to the government. My -- my number one principle is there'll be no tax cut that adds to the deficit.</p>\n    </div>",
      "to": "2012-10-04T09:15:24-05:00"
    },
    {
      "from": "2012-10-04T09:15:24-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>I want to underline that -- no tax cut that adds to the deficit. But I do want to reduce the burden being paid by middle-income Americans. And I -- and to do that that also means that I cannot reduce the burden paid by high-income Americans. So any -- any language to the contrary is simply not accurate.</p>\n    </div>",
      "to": "2012-10-04T09:15:40-05:00"
    },
    {
      "from": "2012-10-04T09:15:40-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Mr. President.</p>\n    </div>",
      "to": "2012-10-04T09:15:41-05:00"
    },
    {
      "from": "2012-10-04T09:15:41-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, I think -- let's talk about taxes because I think it's instructive. Now, four years ago when I stood on this stage I said that I would cut taxes for middle-class families. And that's exactly what I did. We cut taxes for middle-class families by about $3,600. And the reason is because I believe we do best when the middle class is doing well.</p>\n    </div>",
      "to": "2012-10-04T09:16:07-05:00"
    },
    {
      "from": "2012-10-04T09:16:07-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And by giving them those tax cuts, they had a little more money in their pocket and so maybe they can buy a new car. They are certainly in a better position to weather the extraordinary recession that we went through. They can buy a computer for their kid who's going off to college, which means they're spending more money, businesses have more customers, businesses make more profits and then hire more workers.</p>\n    </div>",
      "to": "2012-10-04T09:16:30-05:00"
    },
    {
      "from": "2012-10-04T09:16:30-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Now, Governor Romney's proposal that he has been promoting for 18 months calls for a $5 trillion tax cut on top of $2 trillion of additional spending for our military. And he is saying that he is going to pay for it by closing loopholes and deductions. The problem is that he's been asked a -- over a hundred times how you would close those deductions and loopholes and he hasn't been able to identify them.</p>\n    </div>",
      "to": "2012-10-04T09:16:57-05:00"
    },
    {
      "from": "2012-10-04T09:16:57-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But I'm going to make an important point here, Jim.</p>\n    </div>",
      "to": "2012-10-04T09:16:59-05:00"
    },
    {
      "from": "2012-10-04T09:16:59-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>All right.</p>\n    </div>",
      "to": "2012-10-04T09:17:00-05:00"
    },
    {
      "from": "2012-10-04T09:17:00-05:00",
      "speaker": null,
      "sub": "",
      "to": "2012-10-04T09:17:00-05:00"
    },
    {
      "from": "2012-10-04T09:17:00-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>When you add up all the loopholes and deductions that upper income individuals can -- are currently taking advantage of -- if you take those all away -- you don't come close to paying for <span>$5 trillion in tax cuts</span> and $2 trillion in additional military spending. And that's why independent studies looking at this said the only way to meet Governor Romney's pledge of not reducing the deficit -- or -- or -- or not adding to the deficit, is by burdening middle-class families.</p>\n    </div>",
      "to": "2012-10-04T09:17:30-05:00"
    },
    {
      "from": "2012-10-04T09:17:30-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>The average middle-class family with children would pay about $2,000 more. Now, that's not my analysis; that's the analysis of economists who have looked at this. And -- and that kind of top -- top-down economics, where folks at the top are doing well so the average person making 3 million bucks is getting a $250,000 tax break while middle- class families are burdened further, that's not what I believe is a recipe for economic growth.</p>\n    </div>",
      "to": "2012-10-04T09:17:54-05:00"
    },
    {
      "from": "2012-10-04T09:17:54-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>All right. What is the difference?</p>\n    </div>",
      "to": "2012-10-04T09:17:56-05:00"
    },
    {
      "from": "2012-10-04T09:17:56-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well --</p>\n    </div>",
      "to": "2012-10-04T09:17:56-05:00"
    },
    {
      "from": "2012-10-04T09:17:56-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let's just stay on taxes for --</p>\n    </div>",
      "to": "2012-10-04T09:17:58-05:00"
    },
    {
      "from": "2012-10-04T09:17:58-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But I -- but I -- right, right.</p>\n    </div>",
      "to": "2012-10-04T09:17:59-05:00"
    },
    {
      "from": "2012-10-04T09:17:59-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>OK. Yeah, just -- let's just stay on taxes for a moment.</p>\n    </div>",
      "to": "2012-10-04T09:18:01-05:00"
    },
    {
      "from": "2012-10-04T09:18:01-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Yeah. Well, but -- but --</p>\n    </div>",
      "to": "2012-10-04T09:18:02-05:00"
    },
    {
      "from": "2012-10-04T09:18:02-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>What is the difference?</p>\n    </div>",
      "to": "2012-10-04T09:18:03-05:00"
    },
    {
      "from": "2012-10-04T09:18:03-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>-- virtually every -- virtually everything he just said about my tax plan is inaccurate.</p>\n    </div>",
      "to": "2012-10-04T09:18:05-05:00"
    },
    {
      "from": "2012-10-04T09:18:05-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>All right, go --</p>\n    </div>",
      "to": "2012-10-04T09:18:06-05:00"
    },
    {
      "from": "2012-10-04T09:18:06-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>So -- so if -- if the tax plan he described were a tax plan I was asked to support, I'd say absolutely not. I'm not looking for a $5 trillion tax cut. What I've said is I won't put in place a tax cut that adds to the deficit. That's part one. So there's no economist can say Mitt Romney's tax plan adds 5 trillion (dollars) if I say I will not add to the deficit with my tax plan.</p>\n    </div>",
      "to": "2012-10-04T09:18:27-05:00"
    },
    {
      "from": "2012-10-04T09:18:27-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Number two, I will not reduce the share paid by high-income individuals. I -- I know that you and your running mate keep saying that, and I know it's a popular things to say with a lot of people, but it's just not the case. Look, I got five boys. I'm used to people saying something that's not always true, but just keep on repeating it and ultimately hoping I'll believe it -- (scattered laughter) -- but that -- that is not the case, all right? I will not reduce the taxes paid by high-income Americans.</p>\n    </div>",
      "to": "2012-10-04T09:18:51-05:00"
    },
    {
      "from": "2012-10-04T09:18:51-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And number three, I will not, under any circumstances, raise taxes on middle-income families. I will lower taxes on middle-income families. Now, you cite a study. There are six other studies that looked at the study you describe and say it's completely wrong. I saw a study that came out today that said you're going to raise taxes by 3(,000 dollars) to $4,000 on -- on middle-income families. There are all these studies out there.</p>\n    </div>",
      "to": "2012-10-04T09:19:14-05:00"
    },
    {
      "from": "2012-10-04T09:19:14-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But let's get to the bottom line. That is, I want to bring down rates. I want to bring down the rates down, at the same time lower deductions and exemptions and credits and so forth so we keep getting the revenue we need.</p>\n    </div>",
      "to": "2012-10-04T09:19:24-05:00"
    },
    {
      "from": "2012-10-04T09:19:24-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And you think, well, then why lower the rates? And the reason is because small business pays that individual rate. Fifty-four percent of America's workers work in businesses that are taxed not at the corporate tax rate but at the individual tax rate. And if we lower that rate, they will be able to hire more people.</p>\n    </div>",
      "to": "2012-10-04T09:19:45-05:00"
    },
    {
      "from": "2012-10-04T09:19:45-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>For me, this is about jobs.</p>\n    </div>",
      "to": "2012-10-04T09:19:47-05:00"
    },
    {
      "from": "2012-10-04T09:19:47-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>All right. That's where we started.</p>\n    </div>",
      "to": "2012-10-04T09:19:48-05:00"
    },
    {
      "from": "2012-10-04T09:19:48-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>This is about getting jobs for the American people.</p>\n    </div>",
      "to": "2012-10-04T09:19:49-05:00"
    },
    {
      "from": "2012-10-04T09:19:49-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Yeah.</p>\n    </div>",
      "to": "2012-10-04T09:19:50-05:00"
    },
    {
      "from": "2012-10-04T09:19:50-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Do you challenge what the governor just said about his own plan?</p>\n    </div>",
      "to": "2012-10-04T09:19:54-05:00"
    },
    {
      "from": "2012-10-04T09:19:54-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, for 18 months he's been running on this tax plan. And now, five weeks before the election, he's saying that his big, bold idea is \"never mind.\" And the fact is that if you are lowering the rates the way you describe, Governor, then it is not possible to come up with enough deductions and loopholes that only affect high-income individuals to avoid either raising the deficit or burdening the middle class. It's -- it's math. It's arithmetic.</p>\n    </div>",
      "to": "2012-10-04T09:20:27-05:00"
    },
    {
      "from": "2012-10-04T09:20:27-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Now, Governor Romney and I do share a deep interest in encouraging small-business growth. So at the same time that my tax plan has already lowered taxes for 98 percent of families, I also lowered taxes for small businesses 18 times. And what I want to do is continue the tax rates -- the tax cuts that we put into place for small businesses and families.</p>\n    </div>",
      "to": "2012-10-04T09:20:54-05:00"
    },
    {
      "from": "2012-10-04T09:20:54-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But I have said that for incomes over $250,000 a year that we should go back to the rates that we had when Bill Clinton was president, when we created 23 million new jobs, went from deficit to surplus and created a whole lot of millionaires to boot.</p>\n    </div>",
      "to": "2012-10-04T09:21:10-05:00"
    },
    {
      "from": "2012-10-04T09:21:10-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And the reason this is important is because by doing that, we can not only reduce the deficit, we can not only encourage job growth through small businesses, but we're also able to make the investments that are necessary in education or in energy.</p>\n    </div>",
      "to": "2012-10-04T09:21:24-05:00"
    },
    {
      "from": "2012-10-04T09:21:24-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And we do have a difference, though, when it comes to definitions of small business. Now, under -- under my plan, 97 percent of small businesses would not see their income taxes go up. Governor Romney says, well, those top 3 percent, they're the job creators. They'd be burdened.</p>\n    </div>",
      "to": "2012-10-04T09:21:41-05:00"
    },
    {
      "from": "2012-10-04T09:21:41-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But under Governor Romney's definition, there are a whole bunch of millionaires and billionaires who are small businesses. Donald Trump is a small business. And I know Donald Trump doesn't like to think of himself as small anything, but -- but that's how you define small businesses if you're getting business income. And that kind of approach, I believe, will not grow our economy because the only way to pay for it without either burdening the middle class or blowing up our deficit is to make drastic cuts in things like education, making sure that we are continuing to invest in basic science and research, all the things that are helping America grow. And I think that would be a mistake.</p>\n    </div>",
      "to": "2012-10-04T09:22:23-05:00"
    },
    {
      "from": "2012-10-04T09:22:23-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>All right.</p>\n    </div>",
      "to": "2012-10-04T09:22:25-05:00"
    },
    {
      "from": "2012-10-04T09:22:25-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Jim, let me just come back on that -- on that point.</p>\n    </div>",
      "to": "2012-10-04T09:22:27-05:00"
    },
    {
      "from": "2012-10-04T09:22:27-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Just for the -- just for the record --</p>\n    </div>",
      "to": "2012-10-04T09:22:29-05:00"
    },
    {
      "from": "2012-10-04T09:22:29-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>These small businesses we're talking about --</p>\n    </div>",
      "to": "2012-10-04T09:22:30-05:00"
    },
    {
      "from": "2012-10-04T09:22:30-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Excuse me. Just so everybody understands --</p>\n    </div>",
      "to": "2012-10-04T09:22:32-05:00"
    },
    {
      "from": "2012-10-04T09:22:32-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Yeah.</p>\n    </div>",
      "to": "2012-10-04T09:22:33-05:00"
    },
    {
      "from": "2012-10-04T09:22:33-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>-- we're way over our first 15 minutes.</p>\n    </div>",
      "to": "2012-10-04T09:22:35-05:00"
    },
    {
      "from": "2012-10-04T09:22:35-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>It's fun, isn't it?</p>\n    </div>",
      "to": "2012-10-04T09:22:36-05:00"
    },
    {
      "from": "2012-10-04T09:22:36-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>It's OK. It's great.</p>\n    </div>",
      "to": "2012-10-04T09:22:38-05:00"
    },
    {
      "from": "2012-10-04T09:22:38-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>That's OK.</p>\n    </div>",
      "to": "2012-10-04T09:22:39-05:00"
    },
    {
      "from": "2012-10-04T09:22:39-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>No problem. No, you don't have -- you don't have a problem, I don't have a problem, because we're still on the economy, but we're going to come back to taxes and we're going to move on to the deficit and a lot of other things, too.</p>\n    </div>",
      "to": "2012-10-04T09:22:47-05:00"
    },
    {
      "from": "2012-10-04T09:22:47-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>OK, but go ahead, sir.</p>\n    </div>",
      "to": "2012-10-04T09:22:48-05:00"
    },
    {
      "from": "2012-10-04T09:22:48-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>You bet.</p>\n    </div>",
      "to": "2012-10-04T09:22:49-05:00"
    },
    {
      "from": "2012-10-04T09:22:49-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, President, you're -- Mr. President, you're absolutely right, which is that with regards to 97 percent of the businesses are not -- not taxed at the 35 percent tax rate, they're taxed at a lower rate. But those businesses that are in the last 3 percent of businesses happen to employ half -- half -- of all of the people who work in small business. Those are the businesses that employ one quarter of all the workers in America. And your plan is take their tax rate from 35 percent to 40 percent.</p>\n    </div>",
      "to": "2012-10-04T09:23:16-05:00"
    },
    {
      "from": "2012-10-04T09:23:16-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Now, I talked to a guy who has a very small business. He's in the electronics business in -- in St. Louis. He has four employees.</p>\n    </div>",
      "to": "2012-10-04T09:23:22-05:00"
    },
    {
      "from": "2012-10-04T09:23:22-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>He said he and his son calculated how much they pay in taxes. Federal income tax, federal payroll tax, state income tax, state sales tax, state property tax, gasoline tax -- it added up to well over 50 percent of what they earned.</p>\n    </div>",
      "to": "2012-10-04T09:23:36-05:00"
    },
    {
      "from": "2012-10-04T09:23:36-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And your plan is to take the tax rate on successful small businesses from 35 percent to 40 percent. The National Federation of Independent Businesses has said that will cost 700,000 jobs. I don't want to cost jobs. My priority is jobs. And so what I do is I bring down the tax rates, lower deductions and exemptions -- the same idea behind Bowles-Simpson, by the way. Get the rates down, lower deductions and exemptions to create more jobs, because there's nothing better for getting us to a balanced budget than having more people working, earning more money, paying -- (chuckles) -- more taxes. That's by far the most effective and efficient way to get this budget balanced.</p>\n    </div>",
      "to": "2012-10-04T09:24:18-05:00"
    },
    {
      "from": "2012-10-04T09:24:18-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Jim, I -- you may want to move on to another topic, but I would just say this to the American people. If you believe that we can cut taxes by $5 trillion and add $2 trillion in additional spending that the military is not asking for -- $7 trillion, just to give you a sense, over 10 years that's more than our entire defense budget -- and you think that by closing loopholes and deductions for the well-to-do, somehow you will not end up picking up the tab, then Governor Romney's plan may work for you.</p>\n    </div>",
      "to": "2012-10-04T09:24:52-05:00"
    },
    {
      "from": "2012-10-04T09:24:52-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But I think math, common sense and our history shows us that's not a recipe for job growth.</p>\n    </div>",
      "to": "2012-10-04T09:25:00-05:00"
    },
    {
      "from": "2012-10-04T09:25:00-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Look, we've tried this -- we've tried both approaches. The approach that Governor Romney's talking about is the same sales pitch that was made in 2001 and 2003. And we ended up with the slowest job growth in 50 years. We ended up moving from surplus to deficits. And it all culminated in the worst financial crisis since the Great Depression.</p>\n    </div>",
      "to": "2012-10-04T09:25:26-05:00"
    },
    {
      "from": "2012-10-04T09:25:26-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Bill Clinton tried the approach that I'm talking about. We created 23 million new jobs. We went from deficit to surplus, and businesses did very well.</p>\n    </div>",
      "to": "2012-10-04T09:25:38-05:00"
    },
    {
      "from": "2012-10-04T09:25:38-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>So in some ways, we've got some data on which approach is more likely to create jobs and opportunity for Americans, and I believe that the economy works best when middle-class families are getting tax breaks so that they've got some money in their pockets and those of us who have done extraordinarily well because of this magnificent country that we live in, that we can afford to do a little bit more to make sure we're not blowing up the deficit.</p>\n    </div>",
      "to": "2012-10-04T09:26:02-05:00"
    },
    {
      "from": "2012-10-04T09:26:02-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>OK. (Inaudible) --</p>\n    </div>",
      "to": "2012-10-04T09:26:03-05:00"
    },
    {
      "from": "2012-10-04T09:26:03-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Jim, the president began this segment, so I think I get the last word, so I'm going to take it. All right? (Chuckles.)</p>\n    </div>",
      "to": "2012-10-04T09:26:07-05:00"
    },
    {
      "from": "2012-10-04T09:26:07-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, you're going to get the first word in the next segment.</p>\n    </div>",
      "to": "2012-10-04T09:26:08-05:00"
    },
    {
      "from": "2012-10-04T09:26:08-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, but -- but he gets the first word of that segment. I get the last word of that segment, I hope. Let me just make this comment.</p>\n    </div>",
      "to": "2012-10-04T09:26:13-05:00"
    },
    {
      "from": "2012-10-04T09:26:13-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>(Chuckles.) He can -- you can have it. He can --</p>\n    </div>",
      "to": "2012-10-04T09:26:14-05:00"
    },
    {
      "from": "2012-10-04T09:26:14-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>First of all --</p>\n    </div>",
      "to": "2012-10-04T09:26:15-05:00"
    },
    {
      "from": "2012-10-04T09:26:15-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>That's not how it works.</p>\n    </div>",
      "to": "2012-10-04T09:26:16-05:00"
    },
    {
      "from": "2012-10-04T09:26:16-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let me -- let me repeat -- let me repeat what I said -- (inaudible). I'm not in favor of a $5 trillion tax cut. That's not my plan. My plan is not to put in place any tax cut that will add to the deficit. That's point one. So you may keep referring to it as a $5 trillion tax cut, but that's not my plan.</p>\n    </div>",
      "to": "2012-10-04T09:26:29-05:00"
    },
    {
      "from": "2012-10-04T09:26:29-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>OK.</p>\n    </div>",
      "to": "2012-10-04T09:26:30-05:00"
    },
    {
      "from": "2012-10-04T09:26:30-05:00",
      "speaker": null,
      "sub": "",
      "to": "2012-10-04T09:26:30-05:00"
    },
    {
      "from": "2012-10-04T09:26:30-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Number two, let's look at history. My plan is not like anything that's been tried before. My plan is to bring down rates but also bring down deductions and exemptions and credits at the same time so the revenue stays in, but that we bring down rates to get more people working. My priority is putting people back to work in America. They're suffering in this country. And we talk about evidence -- look at the evidence of the last four years. It's absolutely extraordinary. <span>We've got 23 million people out of work or stop looking for work in this country.</span></p>\n    </div>",
      "to": "2012-10-04T09:27:02-05:00"
    },
    {
      "from": "2012-10-04T09:27:02-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>All right.</p>\n    </div>",
      "to": "2012-10-04T09:27:03-05:00"
    },
    {
      "from": "2012-10-04T09:27:03-05:00",
      "speaker": null,
      "sub": "",
      "to": "2012-10-04T09:27:03-05:00"
    },
    {
      "from": "2012-10-04T09:27:03-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>It's just -- it's -- we've got -- we got -- <span>when the president took office, 32 million people on food stamps; 47 million on food stamps today.</span> Economic growth this year slower than last  year, and last year slower than the year before. Going forward with the status quo is not going to cut it for the American people who are struggling today.</p>\n    </div>",
      "to": "2012-10-04T09:27:21-05:00"
    },
    {
      "from": "2012-10-04T09:27:21-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>All right. Let's talk -- we're still on the economy. This is, theoretically now, a second segment still on the economy, and specifically on what do about the federal deficit, the federal debt. And the question -- you each have two minutes on this -- and, Governor Romney you go first because the president went first on segment one. And the question is this: What are the differences between the two of you as to how you would go about tackling the deficit problem in this country?</p>\n    </div>",
      "to": "2012-10-04T09:27:51-05:00"
    },
    {
      "from": "2012-10-04T09:27:51-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, good. I'm glad you raised that. And it's a -- it's a critical issue. I think it's not just an economic issue. I think it's a moral issue. I think it's, frankly, not moral for my generation to keep spending massively more than we take in, knowing those burdens are going to be passed on to the next generation. And they're going to be paying the interest and the principle all their lives. And the amount of debt we're adding, at a trillion a year, is simply not moral.</p>\n    </div>",
      "to": "2012-10-04T09:28:17-05:00"
    },
    {
      "from": "2012-10-04T09:28:17-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>So how do we deal with it? Well, mathematically there are -- there are three ways that you can cut a deficit. One, of course, is to raise taxes. Number two is to cut spending. And number three is to grow the economy because if more people work in a growing economy they're paying taxes and you can get the job done that way.</p>\n    </div>",
      "to": "2012-10-04T09:28:34-05:00"
    },
    {
      "from": "2012-10-04T09:28:34-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>The presidents would -- president would prefer raising taxes. I understand. The problem with raising taxes is that it slows down the rate of growth and you could never quite get the job done. I want to lower spending and encourage economic growth at the same time.</p>\n    </div>",
      "to": "2012-10-04T09:28:46-05:00"
    },
    {
      "from": "2012-10-04T09:28:46-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>What things would I cut from spending? Well, first of all, I will eliminate all programs by this test -- if they don't pass it: Is the program so critical it's worth borrowing money from China to pay for it? And if not, I'll get rid of it. \"Obamacare\" is on my list. I apologize, Mr. President. I use that term with all respect.</p>\n    </div>",
      "to": "2012-10-04T09:29:03-05:00"
    },
    {
      "from": "2012-10-04T09:29:03-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>I like it.</p>\n    </div>",
      "to": "2012-10-04T09:29:04-05:00"
    },
    {
      "from": "2012-10-04T09:29:04-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Good. OK, good. (Laughter.) So I'll get rid of that. I'm sorry, Jim. I'm going to stop the subsidy to PBS. I'm going to stop other things. I like PBS. I love Big Bird. I actually like you too. But I'm not going to -- I'm not going to keep on spending money on things to borrow money from China to pay for it. That's number one.</p>\n    </div>",
      "to": "2012-10-04T09:29:18-05:00"
    },
    {
      "from": "2012-10-04T09:29:18-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Number two, I'll take programs that are currently good programs but I think could be run more efficiently at the state level and send them to state.</p>\n    </div>",
      "to": "2012-10-04T09:29:26-05:00"
    },
    {
      "from": "2012-10-04T09:29:26-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Number three, I'll make government more efficient, and to cut back the number of employees, combine some agencies and departments. My cutbacks will be done through attrition, by the way.</p>\n    </div>",
      "to": "2012-10-04T09:29:35-05:00"
    },
    {
      "from": "2012-10-04T09:29:35-05:00",
      "speaker": null,
      "sub": "",
      "to": "2012-10-04T09:29:35-05:00"
    },
    {
      "from": "2012-10-04T09:29:35-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>This is the approach we have to take to get America to a balanced budget. The president said he'd cut the deficit in half. Unfortunately, he doubled it. Trillion-dollar deficits for the last four years. The president's put it in place as much public debt -- <span>almost as much debt held by by the public as all prior presidents combined.</span></p>\n    </div>",
      "to": "2012-10-04T09:29:55-05:00"
    },
    {
      "from": "2012-10-04T09:29:55-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Mr. President. two minutes.</p>\n    </div>",
      "to": "2012-10-04T09:29:57-05:00"
    },
    {
      "from": "2012-10-04T09:29:57-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>When I walked in the Oval Office, I had more than a trillion dollar deficit greeting me, and we know where it came from. Two wars that were paid for on a credit card. Two tax cuts that were not paid for, and a whole bunch of programs that were not paid for. And then a massive economic crisis.</p>\n    </div>",
      "to": "2012-10-04T09:30:19-05:00"
    },
    {
      "from": "2012-10-04T09:30:19-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And despite that, what we've said is, yes, we had to take some initial emergency measures to make sure we didn't slip into a Great Depression. But what we've also said is, let's make sure that we are cutting out those things that are not helping us grow.</p>\n    </div>",
      "to": "2012-10-04T09:30:34-05:00"
    },
    {
      "from": "2012-10-04T09:30:34-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>So, 77 government programs -- everything from aircrafts that the Air Force had ordered but weren't working very well. Eighteen government -- 18 government programs for education that were well- intentioned but weren't helping kids learn. We went after medical fraud in Medicare and Medicaid very aggressively -- more aggressively than ever before, and have saved tens of billions of dollars. Fifty billion dollars of waste taken out of the system.</p>\n    </div>",
      "to": "2012-10-04T09:31:00-05:00"
    },
    {
      "from": "2012-10-04T09:31:00-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And I worked with Democrats and Republicans to cut a trillion dollars out of our discretionary domestic budget. That's the largest cut in the discretionary domestic budget since Dwight Eisenhower.</p>\n    </div>",
      "to": "2012-10-04T09:31:13-05:00"
    },
    {
      "from": "2012-10-04T09:31:13-05:00",
      "speaker": null,
      "sub": "",
      "to": "2012-10-04T09:31:13-05:00"
    },
    {
      "from": "2012-10-04T09:31:13-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Now, we all know that we've got to do more. <span>And so I've put forward a specific $4 trillion deficit-reduction plan.</span></p>\n    </div>",
      "to": "2012-10-04T09:31:21-05:00"
    },
    {
      "from": "2012-10-04T09:31:21-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>It's on a website. You can look at all the numbers, what cuts we make and what revenue we raise.</p>\n    </div>",
      "to": "2012-10-04T09:31:27-05:00"
    },
    {
      "from": "2012-10-04T09:31:27-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And the way we do it is $2.50 for every cut, we ask for a dollar of additional revenue, paid for, as I indicated earlier, by asking those of us who have done very well in this country to contribute a little bit more to reduce the deficit.</p>\n    </div>",
      "to": "2012-10-04T09:31:43-05:00"
    },
    {
      "from": "2012-10-04T09:31:43-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And Governor Romney earlier mentioned the Bowles-Simpson commission. Well, that's how the commission -- bipartisan commission that talked about how we should move forward suggested we have to do it -- in a balanced way with some revenue and some spending cuts. And this is a major difference that Governor Romney and I have.</p>\n    </div>",
      "to": "2012-10-04T09:32:01-05:00"
    },
    {
      "from": "2012-10-04T09:32:01-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let -- let me just finish this point because you're looking for contrast. You know, when Governor Romney stood on a stage with other Republican candidates for the nomination, and he was asked, would you take $10 of spending cuts for just $1 of revenue, and he said no. Now, if you take such an unbalanced approach, then that means you are going to be gutting our investments in schools and education. It means that -- Governor Romney talked about Medicaid and how we could send it back to the states, but effectively this means a 30 percent cut in the primary program we help for seniors who are in nursing homes, for kids who are with disabilities --</p>\n    </div>",
      "to": "2012-10-04T09:32:45-05:00"
    },
    {
      "from": "2012-10-04T09:32:45-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Mr. President, I'm sorry --</p>\n    </div>",
      "to": "2012-10-04T09:32:46-05:00"
    },
    {
      "from": "2012-10-04T09:32:46-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And that is not a right strategy for us to move forward.</p>\n    </div>",
      "to": "2012-10-04T09:32:49-05:00"
    },
    {
      "from": "2012-10-04T09:32:49-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Way over the two minutes.</p>\n    </div>",
      "to": "2012-10-04T09:32:50-05:00"
    },
    {
      "from": "2012-10-04T09:32:50-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Sorry.</p>\n    </div>",
      "to": "2012-10-04T09:32:51-05:00"
    },
    {
      "from": "2012-10-04T09:32:51-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Governor, what about Simpson-Bowles. Will you support Simpson-Bowles?</p>\n    </div>",
      "to": "2012-10-04T09:32:54-05:00"
    },
    {
      "from": "2012-10-04T09:32:54-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Simpson-Bowles, the president should have grabbed that.</p>\n    </div>",
      "to": "2012-10-04T09:32:57-05:00"
    },
    {
      "from": "2012-10-04T09:32:57-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>No, I mean do you support Simpson-Bowles?</p>\n    </div>",
      "to": "2012-10-04T09:32:59-05:00"
    },
    {
      "from": "2012-10-04T09:32:59-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>I have my own plan. It's not the same as Simpson- Bowles. But in my view, the president should have grabbed it. If you wanted to make some adjustments to it, take it, go to Congress, fight for it.</p>\n    </div>",
      "to": "2012-10-04T09:33:08-05:00"
    },
    {
      "from": "2012-10-04T09:33:08-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>That's what we've done, made some adjustments to it; and we're putting it forward before Congress right now, a $4 trillion plan, (a balanced ?) --</p>\n    </div>",
      "to": "2012-10-04T09:33:13-05:00"
    },
    {
      "from": "2012-10-04T09:33:13-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But you've been -- but you've been president four years. You've been president four years. You said you'd cut the deficit in half. It's now four years later. We still have trillion- dollar deficits.</p>\n    </div>",
      "to": "2012-10-04T09:33:19-05:00"
    },
    {
      "from": "2012-10-04T09:33:19-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>The CBO says we'll have a trillion-dollar deficit each of the next four years. If you're re-elected, we'll get to a trillion-dollar debt. You have said before you'd cut the deficit in half. And this four -- I love this idea of 4 trillion (dollars) in cuts. You've found $4 trillion of ways to reduce or to get closer to a balanced budget, except we still show trillion dollar deficits every year. That doesn't get the job done.</p>\n    </div>",
      "to": "2012-10-04T09:33:41-05:00"
    },
    {
      "from": "2012-10-04T09:33:41-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let me come back and say, why is that I don't want to raise taxes? Why don't I want to raise taxes on people? And actually, you said it back in 2010. You said, look, I'm going to extend the tax policies that we have. Now, I'm not going to raise taxes on anyone because when the economy's growing slow like this, when we're in recession you shouldn't raise taxes on anyone.</p>\n    </div>",
      "to": "2012-10-04T09:34:01-05:00"
    },
    {
      "from": "2012-10-04T09:34:01-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, the economy is still growing slow. As a matter of fact, it's growing much more slowly now than when you made that statement. And so if you believe the same thing, you just don't want to raise taxes on people. And the reality is it's not just wealthy people -- you mentioned Donald Trump -- it's not just Donald Trump you're taxing; it's all those businesses that employ one-quarter of the workers in America. These small businesses that are taxed as individuals. You raise taxes and you kill jobs. That's why the National Federation of Independent Businesses said your plan will kill 700,000 jobs. I don't want to kill jobs in this environment.</p>\n    </div>",
      "to": "2012-10-04T09:34:34-05:00"
    },
    {
      "from": "2012-10-04T09:34:34-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let me make one more point. And that's -- and that --</p>\n    </div>",
      "to": "2012-10-04T09:34:36-05:00"
    },
    {
      "from": "2012-10-04T09:34:36-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let's let him answer the taxes thing for a moment, OK?</p>\n    </div>",
      "to": "2012-10-04T09:34:38-05:00"
    },
    {
      "from": "2012-10-04T09:34:38-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>OK.</p>\n    </div>",
      "to": "2012-10-04T09:34:40-05:00"
    },
    {
      "from": "2012-10-04T09:34:40-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Mr. President.</p>\n    </div>",
      "to": "2012-10-04T09:34:41-05:00"
    },
    {
      "from": "2012-10-04T09:34:41-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, we've had this discussion before.</p>\n    </div>",
      "to": "2012-10-04T09:34:43-05:00"
    },
    {
      "from": "2012-10-04T09:34:43-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>No, about the idea that in order to reduce the deficit there has to be revenue in addition to cuts.</p>\n    </div>",
      "to": "2012-10-04T09:34:49-05:00"
    },
    {
      "from": "2012-10-04T09:34:49-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>There has to be revenue in addition to cuts. Now, Governor Romney has ruled out revenue. He's -- he's ruled out revenue.</p>\n    </div>",
      "to": "2012-10-04T09:34:55-05:00"
    },
    {
      "from": "2012-10-04T09:34:55-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>That's true, right?</p>\n    </div>",
      "to": "2012-10-04T09:34:56-05:00"
    },
    {
      "from": "2012-10-04T09:34:56-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Absolutely.</p>\n    </div>",
      "to": "2012-10-04T09:34:57-05:00"
    },
    {
      "from": "2012-10-04T09:34:57-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>OK, so --</p>\n    </div>",
      "to": "2012-10-04T09:34:58-05:00"
    },
    {
      "from": "2012-10-04T09:34:58-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Completely?</p>\n    </div>",
      "to": "2012-10-04T09:34:59-05:00"
    },
    {
      "from": "2012-10-04T09:34:59-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>I -- look, the revenue I get is by more people working, getting higher pay, paying more taxes. That's how we get growth and how we balance the budget. But the idea of taxing people more, putting more people out of work -- you'll never get there. You never balance the budget by raising taxes.</p>\n    </div>",
      "to": "2012-10-04T09:35:13-05:00"
    },
    {
      "from": "2012-10-04T09:35:13-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Spain -- Spain spends 42 percent of their total economy on government. We're now spending 42 percent of our economy on government.</p>\n    </div>",
      "to": "2012-10-04T09:35:22-05:00"
    },
    {
      "from": "2012-10-04T09:35:22-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>I don't want to go down the path to Spain. I want to go down the path of growth that puts Americans to work, with more money coming in because they're working.</p>\n    </div>",
      "to": "2012-10-04T09:35:29-05:00"
    },
    {
      "from": "2012-10-04T09:35:29-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Yeah.</p>\n    </div>",
      "to": "2012-10-04T09:35:31-05:00"
    },
    {
      "from": "2012-10-04T09:35:31-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But Mr. President, you're saying in order to get it -- the job done, it's got to be balanced. You've got to have --</p>\n    </div>",
      "to": "2012-10-04T09:35:36-05:00"
    },
    {
      "from": "2012-10-04T09:35:36-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>If we're serious, we've got to take a balanced, responsible approach. And by the way, this is not just when it comes to individual taxes.</p>\n    </div>",
      "to": "2012-10-04T09:35:43-05:00"
    },
    {
      "from": "2012-10-04T09:35:43-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let's talk about corporate taxes. Now, I've identified areas where we can, right away, make a change that I believe would actually help the economy. The -- the oil industry gets $4 billion a year in corporate welfare. Basically, they get deductions that those small businesses that Governor Romney refers to, they don't get. Now, does anybody think that ExxonMobil needs some extra money when they're making money every time you go to the pump? Why wouldn't we want to eliminate that?</p>\n    </div>",
      "to": "2012-10-04T09:36:19-05:00"
    },
    {
      "from": "2012-10-04T09:36:19-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Why wouldn't we eliminate tax breaks for corporate jets? My attitude is if you got a corporate jet, you can probably afford to pay full freight, not get a special break for it.</p>\n    </div>",
      "to": "2012-10-04T09:36:30-05:00"
    },
    {
      "from": "2012-10-04T09:36:30-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>When it comes to corporate taxes, Governor Romney has said he wants to, in a revenue-neutral way, close loopholes, deductions -- he hasn't identified which ones they are -- but thereby bring down the corporate rate. Well, I want to do the same thing, but I've actually identified how we can do that.</p>\n    </div>",
      "to": "2012-10-04T09:36:48-05:00"
    },
    {
      "from": "2012-10-04T09:36:48-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And part of the way to do it is to not give tax breaks to companies that are shipping jobs overseas. Right now you can actually take a deduction for moving a plant overseas. I think most Americans would say that doesn't make sense. And all that raises revenue.</p>\n    </div>",
      "to": "2012-10-04T09:37:05-05:00"
    },
    {
      "from": "2012-10-04T09:37:05-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And so if we take a balanced approach, what that then allows us to do is also to help young people, the way we already have during my administration, make sure that they can afford to go to college. It means that the teacher that I met in Las Vegas, wonderful young lady, who describes to me -- she's got 42 kids in her class.</p>\n    </div>",
      "to": "2012-10-04T09:37:26-05:00"
    },
    {
      "from": "2012-10-04T09:37:26-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>The first two weeks, she's got them -- some of them sitting on the floor until finally they get reassigned. They're using textbooks that are 10 years old. That is not a recipe for growth; that's not how America was built.</p>\n    </div>",
      "to": "2012-10-04T09:37:40-05:00"
    },
    {
      "from": "2012-10-04T09:37:40-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And so budgets reflect choices. Ultimately we're going to have to make some decisions. And if we're asking for no revenue, then that means that we've got to get rid of a whole bunch of stuff, and the magnitude of the tax cuts that you're talking about, Governor, would end up resulting in severe hardship for people, but more importantly, would not help us grow.</p>\n    </div>",
      "to": "2012-10-04T09:38:02-05:00"
    },
    {
      "from": "2012-10-04T09:38:02-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>As I indicated before, when you talk about shifting Medicaid to states, we're talking about potentially a -- a 30 -- a 30 percent cut in Medicaid over time. Now, you know, that may not seem like a big deal when it just is -- you know, numbers on a sheet of paper, but if we're talking about a family who's got an autistic kid and is depending on that Medicaid, that's a big problem. And governors are creative. There's no doubt about it. But they're not creative enough to make up for 30 percent of revenue on something like Medicaid. What ends up happening is some people end up not getting help.</p>\n    </div>",
      "to": "2012-10-04T09:38:38-05:00"
    },
    {
      "from": "2012-10-04T09:38:38-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Jim, let's -- we -- we've gone on a lot of topics there, and -- so I've got to take -- it's going to take a minute to go from Medicaid to schools to --</p>\n    </div>",
      "to": "2012-10-04T09:38:45-05:00"
    },
    {
      "from": "2012-10-04T09:38:45-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>(Inaudible.)</p>\n    </div>",
      "to": "2012-10-04T09:38:46-05:00"
    },
    {
      "from": "2012-10-04T09:38:46-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Come back to Medicaid, here, yeah, yeah, right.</p>\n    </div>",
      "to": "2012-10-04T09:38:48-05:00"
    },
    {
      "from": "2012-10-04T09:38:48-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>-- oil to tax breaks and companies overseas. So let's go through them one by one. First of all, the Department of Energy has said the tax break for oil companies is $2.8 billion a year. And it's actually an accounting treatment, as you know, that's been in place for a hundred years. Now --</p>\n    </div>",
      "to": "2012-10-04T09:39:01-05:00"
    },
    {
      "from": "2012-10-04T09:39:01-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>It's time to end it.</p>\n    </div>",
      "to": "2012-10-04T09:39:02-05:00"
    },
    {
      "from": "2012-10-04T09:39:02-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And -- and in one year, you provided $90 billion in breaks to the green energy world. Now, I like green energy as well, but that's about 50 years' worth of what oil and gas receives, and you say Exxon and Mobil -- actually, this $2.8 billion goes largely to small companies, to drilling operators and so forth.</p>\n    </div>",
      "to": "2012-10-04T09:39:21-05:00"
    },
    {
      "from": "2012-10-04T09:39:21-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But you know, if we get that tax rate from 35 percent down to 25 percent, why, that $2.8 billion is on the table. Of course it's on the table. That's probably not going to survive, you get that rate down to 25 percent.</p>\n    </div>",
      "to": "2012-10-04T09:39:32-05:00"
    },
    {
      "from": "2012-10-04T09:39:32-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But -- but don't forget, you put $90 billion -- like 50 years worth of breaks -- into solar and wind, to -- to Solyndra and Fisker and Tesla and Ener1. I mean, I -- I had a friend who said, you don't just pick the winners and losers; you pick the losers. All right? So -- so this is not -- this is not the kind of policy you want to have if you want to get America energy-secure.</p>\n    </div>",
      "to": "2012-10-04T09:39:54-05:00"
    },
    {
      "from": "2012-10-04T09:39:54-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>The second topic, which is you said you get a deduction for getting a plant overseas. Look, I've been in business for 25 years. I have no idea what you're talking about. I maybe need to get a new accountant.</p>\n    </div>",
      "to": "2012-10-04T09:40:05-05:00"
    },
    {
      "from": "2012-10-04T09:40:05-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let's --</p>\n    </div>",
      "to": "2012-10-04T09:40:06-05:00"
    },
    {
      "from": "2012-10-04T09:40:06-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But the -- the idea that you get a break for shipping jobs overseas is simply not the case.</p>\n    </div>",
      "to": "2012-10-04T09:40:10-05:00"
    },
    {
      "from": "2012-10-04T09:40:10-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let's have --</p>\n    </div>",
      "to": "2012-10-04T09:40:11-05:00"
    },
    {
      "from": "2012-10-04T09:40:11-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>What we do have right now is a setting --</p>\n    </div>",
      "to": "2012-10-04T09:40:14-05:00"
    },
    {
      "from": "2012-10-04T09:40:14-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Excuse me.</p>\n    </div>",
      "to": "2012-10-04T09:40:15-05:00"
    },
    {
      "from": "2012-10-04T09:40:15-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>-- where I'd like to bring money from overseas back to this country.</p>\n    </div>",
      "to": "2012-10-04T09:40:16-05:00"
    },
    {
      "from": "2012-10-04T09:40:16-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And finally, Medicaid to states, I'm not quite sure where that came in, except this, which is, I would like to take the Medicaid dollars that go to states and say to a state, you're going to get what you got last year plus inflation -- inflation -- plus 1 percent. And then you're going to manage your care for your poor in the way you think best.</p>\n    </div>",
      "to": "2012-10-04T09:40:33-05:00"
    },
    {
      "from": "2012-10-04T09:40:33-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And I remember as a governor, when this idea was floated by Tommy Thompson, the governors, Republican and Democrats, said, please let us do that. We can care for our own poor in so much better and more effective a way than having the federal government tell us how to care for our poor.</p>\n    </div>",
      "to": "2012-10-04T09:40:50-05:00"
    },
    {
      "from": "2012-10-04T09:40:50-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>So let states -- one of the magnificent things about this country is the whole idea that states are the laboratories of democracy. Don't have the federal government tell everybody what kind of training programs they have to have and what kind of Medicaid they have to have. Let states do this.</p>\n    </div>",
      "to": "2012-10-04T09:41:05-05:00"
    },
    {
      "from": "2012-10-04T09:41:05-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And by the way, if a states get -- gets in trouble, why, we could step in and see if we could find a way to help them. But --</p>\n    </div>",
      "to": "2012-10-04T09:41:09-05:00"
    },
    {
      "from": "2012-10-04T09:41:09-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let's go.</p>\n    </div>",
      "to": "2012-10-04T09:41:10-05:00"
    },
    {
      "from": "2012-10-04T09:41:10-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But -- but the right -- the right approach is one which relies on the brilliance --</p>\n    </div>",
      "to": "2012-10-04T09:41:14-05:00"
    },
    {
      "from": "2012-10-04T09:41:14-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Two seconds.</p>\n    </div>",
      "to": "2012-10-04T09:41:15-05:00"
    },
    {
      "from": "2012-10-04T09:41:15-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>-- of our people and states, not the federal government.</p>\n    </div>",
      "to": "2012-10-04T09:41:16-05:00"
    },
    {
      "from": "2012-10-04T09:41:16-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Two seconds and we're going on, still on the economy on another -- but another part of it.</p>\n    </div>",
      "to": "2012-10-04T09:41:18-05:00"
    },
    {
      "from": "2012-10-04T09:41:18-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>OK.</p>\n    </div>",
      "to": "2012-10-04T09:41:19-05:00"
    },
    {
      "from": "2012-10-04T09:41:19-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>All right? All right, this is this is segment three, the economy, entitlements.</p>\n    </div>",
      "to": "2012-10-04T09:41:24-05:00"
    },
    {
      "from": "2012-10-04T09:41:24-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>First answer goes to you. It's two minutes. Mr. President, do you see a major difference between the two of you on Social Security?</p>\n    </div>",
      "to": "2012-10-04T09:41:35-05:00"
    },
    {
      "from": "2012-10-04T09:41:35-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>You know, I suspect that on Social Security, we've got a somewhat similar position. Social Security is structurally sound. It's going to have to be tweaked the way it was by Ronald Reagan and Speaker -- Democratic Speaker Tip O'Neill. But it is -- the basic structure is sound. But -- but I want to talk about the values behind Social Security and Medicare and then talk about Medicare, because that's the big driver --</p>\n    </div>",
      "to": "2012-10-04T09:41:59-05:00"
    },
    {
      "from": "2012-10-04T09:41:59-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Sure -- it -- you bet.</p>\n    </div>",
      "to": "2012-10-04T09:42:01-05:00"
    },
    {
      "from": "2012-10-04T09:42:01-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>-- of our deficits right now.</p>\n    </div>",
      "to": "2012-10-04T09:42:03-05:00"
    },
    {
      "from": "2012-10-04T09:42:03-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>You know, my grandmother, some of you know, helped to raise me. My grandparents did. My grandfather died awhile back. My grandmother died three days before I was elected president. And she was fiercely independent. She worked her way up, only had a high school education, started as a secretary, ended up being the vice president of a local bank. And she ended up living alone by choice. And the reason she could be independent was because of Social Security and Medicare. She had worked all her life, put in this money and understood that there was a basic guarantee, a floor under which she could not go.</p>\n    </div>",
      "to": "2012-10-04T09:42:40-05:00"
    },
    {
      "from": "2012-10-04T09:42:40-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And that's the perspective I bring when I think about what's called entitlements. You know, the name itself implies some sense of dependency on the part of these folks. These are folks who've worked hard, like my grandmother. And there are millions of people out there who are counting on this.</p>\n    </div>",
      "to": "2012-10-04T09:42:56-05:00"
    },
    {
      "from": "2012-10-04T09:42:56-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>So my approach is to say, how do we strengthen the system over the long term? And in Medicare, what we did was we said, we are going to have to bring down the costs if we're going to deal with our long- term deficits, but to do that, let's look where some of the money is going. Seven hundred and sixteen billion dollars we were able to save from the Medicare program by no longer overpaying insurance companies, by making sure that we weren't overpaying providers.</p>\n    </div>",
      "to": "2012-10-04T09:43:26-05:00"
    },
    {
      "from": "2012-10-04T09:43:26-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And using that money, we were actually able to lower prescription drug costs for seniors by an average of $600, and we were also able to make a -- make a significant dent in providing them the kind of preventive care that will ultimately save money through the -- throughout the system.</p>\n    </div>",
      "to": "2012-10-04T09:43:41-05:00"
    },
    {
      "from": "2012-10-04T09:43:41-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>So the way for us to deal with Medicare in particular is to lower health care costs. But when it comes to Social Security, as I said, you don't need a major structural change in order to make sure that Social Security is there for the future.</p>\n    </div>",
      "to": "2012-10-04T09:43:55-05:00"
    },
    {
      "from": "2012-10-04T09:43:55-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>We'll follow up on this.</p>\n    </div>",
      "to": "2012-10-04T09:43:56-05:00"
    },
    {
      "from": "2012-10-04T09:43:56-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>First, Governor Romney, you have two minutes on Social Security and entitlements.</p>\n    </div>",
      "to": "2012-10-04T09:44:01-05:00"
    },
    {
      "from": "2012-10-04T09:44:01-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, Jim, our seniors depend on these programs. And I know any time we talk about entitlements, people become concerned that something's going to happen that's going to change their life for the worst, and the answer is, neither the president nor I are proposing any changes for any current retirees or near retirees, either to Social Security or Medicare. So if you're 60 or around 60 or older, you don't need to listen any further.</p>\n    </div>",
      "to": "2012-10-04T09:44:25-05:00"
    },
    {
      "from": "2012-10-04T09:44:25-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But for younger people, we need to talk about what changes are going to be occurring.</p>\n    </div>",
      "to": "2012-10-04T09:44:29-05:00"
    },
    {
      "from": "2012-10-04T09:44:29-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Oh, I just thought about one, and that is in fact I was wrong when I said the president isn't proposing any changes for current retirees. In fact, he is on Medicare. On Social Security, he's not.</p>\n    </div>",
      "to": "2012-10-04T09:44:38-05:00"
    },
    {
      "from": "2012-10-04T09:44:38-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But on Medicare, for current retirees he's cutting $716 billion from the program. Now, he says by not overpaying hospitals and providers, actually just going to them and saying we're going to reduce the rates you get paid across the board, everybody's going to get a lower rate. That's not just going after places where there's abuse, that's saying we're cutting the rates. Some 15 percent of hospitals and nursing homes say they won't take anymore Medicare patients under that scenario.</p>\n    </div>",
      "to": "2012-10-04T09:45:05-05:00"
    },
    {
      "from": "2012-10-04T09:45:05-05:00",
      "speaker": null,
      "sub": "",
      "to": "2012-10-04T09:45:05-05:00"
    },
    {
      "from": "2012-10-04T09:45:05-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>We also have 50 percent of doctors who say they won't take more Medicare patients. This -- we have 4 million people on Medicare Advantage that will lose Medicare Advantage because of those <span>$716 billion in cuts</span>. I can't understand how you can <span>cut Medicare $716 billion</span> for current recipients of Medicare.</p>\n    </div>",
      "to": "2012-10-04T09:45:27-05:00"
    },
    {
      "from": "2012-10-04T09:45:27-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Now, you point out, well, we're putting some back; we're going to give a better prescription program. That's one -- that's $1 for every 15 (dollars) you've cut. They're smart enough to know that's not a good trade.</p>\n    </div>",
      "to": "2012-10-04T09:45:37-05:00"
    },
    {
      "from": "2012-10-04T09:45:37-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>I want to take that $716 billion you've cut and put it back into Medicare. By the way, we can include a prescription program if we need to improve it, but the idea of cutting $716 billion from Medicare to be able to balance the additional cost of \"Obamacare\" is, in my opinion, a mistake. And with regards to young people coming along, I've got proposals to make sure Medicare and Social Security are there for them without any question.</p>\n    </div>",
      "to": "2012-10-04T09:46:02-05:00"
    },
    {
      "from": "2012-10-04T09:46:02-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Mr. President.</p>\n    </div>",
      "to": "2012-10-04T09:46:03-05:00"
    },
    {
      "from": "2012-10-04T09:46:03-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>First of all, I think it's important for Governor Romney to present this plan that he says will only affect folks in the future. And the essence of the plan is that he would turn Medicare into a voucher program. It's called premium support, but it's understood to be a voucher program. His running mate --</p>\n    </div>",
      "to": "2012-10-04T09:46:23-05:00"
    },
    {
      "from": "2012-10-04T09:46:23-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And you -- and you don't support that?</p>\n    </div>",
      "to": "2012-10-04T09:46:24-05:00"
    },
    {
      "from": "2012-10-04T09:46:24-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>I don't. And -- and let me explain why.</p>\n    </div>",
      "to": "2012-10-04T09:46:27-05:00"
    },
    {
      "from": "2012-10-04T09:46:27-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Again, that's for future people --</p>\n    </div>",
      "to": "2012-10-04T09:46:29-05:00"
    },
    {
      "from": "2012-10-04T09:46:29-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>I understand.</p>\n    </div>",
      "to": "2012-10-04T09:46:30-05:00"
    },
    {
      "from": "2012-10-04T09:46:30-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>-- right, not for current retirees.</p>\n    </div>",
      "to": "2012-10-04T09:46:31-05:00"
    },
    {
      "from": "2012-10-04T09:46:31-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>For -- for -- so if you're -- if you -- you're 54 or 55, you might want to listen, because this -- this will affect you. The idea, which was originally presented by Congressman Ryan, your running mate, is that we would give a voucher to seniors, and they could go out in the private marketplace and buy their own health insurance. The problem is that because the voucher wouldn't necessarily keep up with health care inflation, it was estimated that this would cost the average senior about $6,000 a year.</p>\n    </div>",
      "to": "2012-10-04T09:47:04-05:00"
    },
    {
      "from": "2012-10-04T09:47:04-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Now, in fairness, what Governor Romney has now said is he'll maintain traditional Medicare alongside it. But there's still a problem, because what happens is those insurance companies are pretty clever at figuring out who are the younger and healthier seniors.</p>\n    </div>",
      "to": "2012-10-04T09:47:20-05:00"
    },
    {
      "from": "2012-10-04T09:47:20-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>They recruit them leaving the older, sicker seniors in Medicare. And every health care economist who looks at it says over time what'll happen is the traditional Medicare system will collapse. And then what you've got is folks like my grandmother at the mercy of the private insurance system, precisely at the time when they are most in need of decent health care.</p>\n    </div>",
      "to": "2012-10-04T09:47:42-05:00"
    },
    {
      "from": "2012-10-04T09:47:42-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>So I don't think vouchers are the right way to go. And this is not my own -- only my opinion. AARP thinks that the -- the savings that we obtained from Medicare bolster the system, lengthen the Medicare trust fund by 8 years. Benefits were not affected at all and ironically if you repeal \"Obamacare\" -- and I have become fond of this term, \"Obamacare\" -- (laughter) -- if you repeal it, what happens is those seniors right away are going to be paying $600 more in prescription care. They're now going to have to be paying copays for basic check-ups that can keep them healthier.</p>\n    </div>",
      "to": "2012-10-04T09:48:21-05:00"
    },
    {
      "from": "2012-10-04T09:48:21-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And the primary beneficiary of that repeal are insurance companies that are estimated to gain billions of dollars back when they aren't making seniors any healthier. And I -- I don't think that's right approach when it comes to making sure that Medicare is stronger over the long term.</p>\n    </div>",
      "to": "2012-10-04T09:48:41-05:00"
    },
    {
      "from": "2012-10-04T09:48:41-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>We'll talk about -- specifically about health care in a moment, but what is -- do you support the voucher system, Governor?</p>\n    </div>",
      "to": "2012-10-04T09:48:47-05:00"
    },
    {
      "from": "2012-10-04T09:48:47-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>What I support is no change for current retirees and near-retirees to Medicare and the president supports taking <span>$716 billion out of that program.</span></p>\n    </div>",
      "to": "2012-10-04T09:48:58-05:00"
    },
    {
      "from": "2012-10-04T09:48:58-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>What about the vouchers?</p>\n    </div>",
      "to": "2012-10-04T09:48:59-05:00"
    },
    {
      "from": "2012-10-04T09:48:59-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>So that's -- that's number one.</p>\n    </div>",
      "to": "2012-10-04T09:49:00-05:00"
    },
    {
      "from": "2012-10-04T09:49:00-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>OK. All right.</p>\n    </div>",
      "to": "2012-10-04T09:49:01-05:00"
    },
    {
      "from": "2012-10-04T09:49:01-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Number two is for people coming along that are young. What I'd do to make sure that we can keep Medicare in place for them is to allow them either to choose the current Medicare program or a private plan -- their choice. They get to -- and they'll have at least two plans that will be entirely at no cost to them. So they don't have to pay additional money, no additional $6,000. That's not going to happen.</p>\n    </div>",
      "to": "2012-10-04T09:49:23-05:00"
    },
    {
      "from": "2012-10-04T09:49:23-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>They'll have at least two plans.</p>\n    </div>",
      "to": "2012-10-04T09:49:24-05:00"
    },
    {
      "from": "2012-10-04T09:49:24-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And by the way, if the government can be as efficient as the private sector and offer premiums that are as low as the private sector, people will be happy to get traditional Medicare, or they'll be able to get a private plan. I know my own view is I'd rather have a private plan. I -- I'd just as soon not have the government telling me what kind of health care I get. I'd rather be able to have an insurance company. If I don't like them, I can get rid of them and find a different insurance company. But people will make their own choice.</p>\n    </div>",
      "to": "2012-10-04T09:49:47-05:00"
    },
    {
      "from": "2012-10-04T09:49:47-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>The other thing we have to do to save Medicare, we have to have the benefits high for those that are low-income, but for higher-income people, we're going to have to lower some of the benefits. We have to make sure this program is there for the long term. That's the plan that I've put forward.</p>\n    </div>",
      "to": "2012-10-04T09:50:00-05:00"
    },
    {
      "from": "2012-10-04T09:50:00-05:00",
      "speaker": null,
      "sub": "",
      "to": "2012-10-04T09:50:00-05:00"
    },
    {
      "from": "2012-10-04T09:50:00-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And by the way, the idea came not even from Paul Ryan or -- or Senator Wyden, who's a co-author of the bill with -- with Paul Ryan in the Senate, but also it came from Bill Clinton's -- Bill Clinton's chief of staff. This is an idea that's been around a long time, which is saying, hey, <span>let's see if we can't get competition into the Medicare world so that people can get the choice of different plans at lower cost, better quality. I believe in competition.</span></p>\n    </div>",
      "to": "2012-10-04T09:50:25-05:00"
    },
    {
      "from": "2012-10-04T09:50:25-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Jim, if I -- if I can just respond very quickly, first of all, every study has shown that Medicare has lower administrative cost than private insurance does, which is why seniors are generally pretty happy with it. And private insurers have to make a profit. Nothing wrong with that; that's what they do. And so you've got higher administrative costs, plus profit on top of that, and if you are going to save any money through what Governor Romney's proposing, what has to happen is is that the money has to come from somewhere.</p>\n    </div>",
      "to": "2012-10-04T09:50:58-05:00"
    },
    {
      "from": "2012-10-04T09:50:58-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And when you move to a voucher system, you are putting seniors at the mercy of those insurance companies. And over time, if traditional Medicare has decayed or fallen apart, then they're stuck. And this is the reason why AARP has said that your plan would weaken Medicare substantially, and that's why they were supportive of the approach that we took.</p>\n    </div>",
      "to": "2012-10-04T09:51:24-05:00"
    },
    {
      "from": "2012-10-04T09:51:24-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>One last point I want to make. We do have to lower the cost of health care. Not just in Medicare and --</p>\n    </div>",
      "to": "2012-10-04T09:51:31-05:00"
    },
    {
      "from": "2012-10-04T09:51:31-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>We'll talk about that in a minute.</p>\n    </div>",
      "to": "2012-10-04T09:51:32-05:00"
    },
    {
      "from": "2012-10-04T09:51:32-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>-- but -- but overall.</p>\n    </div>",
      "to": "2012-10-04T09:51:33-05:00"
    },
    {
      "from": "2012-10-04T09:51:33-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Go. OK.</p>\n    </div>",
      "to": "2012-10-04T09:51:34-05:00"
    },
    {
      "from": "2012-10-04T09:51:34-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And so --</p>\n    </div>",
      "to": "2012-10-04T09:51:35-05:00"
    },
    {
      "from": "2012-10-04T09:51:35-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>That's -- that's a big topic. Could we -- could we stay on Medicare?</p>\n    </div>",
      "to": "2012-10-04T09:51:37-05:00"
    },
    {
      "from": "2012-10-04T09:51:37-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Is that a -- is that a separate topic? I'm sorry.</p>\n    </div>",
      "to": "2012-10-04T09:51:39-05:00"
    },
    {
      "from": "2012-10-04T09:51:39-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Yeah, we're going to -- yeah. I want to get to it, but all I want to do is very quickly --</p>\n    </div>",
      "to": "2012-10-04T09:51:40-05:00"
    },
    {
      "from": "2012-10-04T09:51:40-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let's get back to Medicare.</p>\n    </div>",
      "to": "2012-10-04T09:51:41-05:00"
    },
    {
      "from": "2012-10-04T09:51:41-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>-- before we leave the economy --</p>\n    </div>",
      "to": "2012-10-04T09:51:42-05:00"
    },
    {
      "from": "2012-10-04T09:51:42-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let's get back to Medicare.</p>\n    </div>",
      "to": "2012-10-04T09:51:43-05:00"
    },
    {
      "from": "2012-10-04T09:51:43-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>No, no, no, no --</p>\n    </div>",
      "to": "2012-10-04T09:51:44-05:00"
    },
    {
      "from": "2012-10-04T09:51:44-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>The president said that the government can provide the service at lower --</p>\n    </div>",
      "to": "2012-10-04T09:51:45-05:00"
    },
    {
      "from": "2012-10-04T09:51:45-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>No.</p>\n    </div>",
      "to": "2012-10-04T09:51:46-05:00"
    },
    {
      "from": "2012-10-04T09:51:46-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>-- cost and without a profit.</p>\n    </div>",
      "to": "2012-10-04T09:51:47-05:00"
    },
    {
      "from": "2012-10-04T09:51:47-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>If that's the case, then it will always be the best product that people can purchase. But my experience --</p>\n    </div>",
      "to": "2012-10-04T09:51:50-05:00"
    },
    {
      "from": "2012-10-04T09:51:50-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Wait a minute, Governor.</p>\n    </div>",
      "to": "2012-10-04T09:51:52-05:00"
    },
    {
      "from": "2012-10-04T09:51:52-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>My experience is the private sector typically is able to provide a better product at a lower cost.</p>\n    </div>",
      "to": "2012-10-04T09:51:54-05:00"
    },
    {
      "from": "2012-10-04T09:51:54-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Can we -- can the two of you agree that the voters have a choice, a clear choice between the two of you --</p>\n    </div>",
      "to": "2012-10-04T09:52:01-05:00"
    },
    {
      "from": "2012-10-04T09:52:01-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Absolutely.</p>\n    </div>",
      "to": "2012-10-04T09:52:02-05:00"
    },
    {
      "from": "2012-10-04T09:52:02-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Yes.</p>\n    </div>",
      "to": "2012-10-04T09:52:04-05:00"
    },
    {
      "from": "2012-10-04T09:52:04-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>-- on Medicare?</p>\n    </div>",
      "to": "2012-10-04T09:52:05-05:00"
    },
    {
      "from": "2012-10-04T09:52:05-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Absolutely.</p>\n    </div>",
      "to": "2012-10-04T09:52:06-05:00"
    },
    {
      "from": "2012-10-04T09:52:06-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>All right. So, to finish quickly, briefly, on the economy, what is your view about the level of federal regulation of the economy right now? Is there too much, and in your case, Mr. President, is there -- should there be more? Beginning with you -- this is not a new two-minute segment -- to start, and we'll go for a few minutes and then we're going to go to health care. OK?</p>\n    </div>",
      "to": "2012-10-04T09:52:28-05:00"
    },
    {
      "from": "2012-10-04T09:52:28-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Regulation is essential. You can't have a free market work if you don't have regulation. As a business person, I had to have -- I needed to know the regulations. I needed them there. You couldn't have people opening up banks in their -- in their garage and making loans. I mean, you have to have regulations so that you can have an economy work. Every free economy has good regulation.</p>\n    </div>",
      "to": "2012-10-04T09:52:48-05:00"
    },
    {
      "from": "2012-10-04T09:52:48-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>At the same time, regulation can become excessive.</p>\n    </div>",
      "to": "2012-10-04T09:52:51-05:00"
    },
    {
      "from": "2012-10-04T09:52:51-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Is it excessive now, do you think?</p>\n    </div>",
      "to": "2012-10-04T09:52:53-05:00"
    },
    {
      "from": "2012-10-04T09:52:53-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>In some places, yes, in other places, no.</p>\n    </div>",
      "to": "2012-10-04T09:52:54-05:00"
    },
    {
      "from": "2012-10-04T09:52:54-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Like where?</p>\n    </div>",
      "to": "2012-10-04T09:52:55-05:00"
    },
    {
      "from": "2012-10-04T09:52:55-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>It can become out of date. And what's happened in -- with some of the legislation that's been passed during the president's term, you've seen regulation become excessive and it's hurt the -- it's hurt the economy. Let me give you an example. Dodd- Frank was passed, and it includes within it a number of provisions that I think have some unintended consequences that are harmful to the economy. One is it designates a number of banks as too big to fail, and they're effectively guaranteed by the federal government.</p>\n    </div>",
      "to": "2012-10-04T09:53:22-05:00"
    },
    {
      "from": "2012-10-04T09:53:22-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>This is the biggest kiss that's been given to -- to New York banks I've ever seen. This is an enormous boon for them. There's been -- 122 community and small banks have closed since Dodd-Frank. So there's one example.</p>\n    </div>",
      "to": "2012-10-04T09:53:34-05:00"
    },
    {
      "from": "2012-10-04T09:53:34-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Here's another. In Dodd-Frank, it says that --</p>\n    </div>",
      "to": "2012-10-04T09:53:37-05:00"
    },
    {
      "from": "2012-10-04T09:53:37-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>You want to repeal Dodd-Frank?</p>\n    </div>",
      "to": "2012-10-04T09:53:38-05:00"
    },
    {
      "from": "2012-10-04T09:53:38-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, I would repeal it and replace it. You -- we're not going to get rid of all regulation. You have to have regulation. And there's some parts of Dodd-Frank that make all the sense in the world. You need transparency, you need to have leverage limits for institutes --</p>\n    </div>",
      "to": "2012-10-04T09:53:50-05:00"
    },
    {
      "from": "2012-10-04T09:53:50-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, here's a specific -- let's -- excuse me --</p>\n    </div>",
      "to": "2012-10-04T09:53:52-05:00"
    },
    {
      "from": "2012-10-04T09:53:52-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let me mention the other one. Let's talk the --</p>\n    </div>",
      "to": "2012-10-04T09:53:54-05:00"
    },
    {
      "from": "2012-10-04T09:53:54-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>No, no, let's do -- right now, let's not. Let's let him respond.</p>\n    </div>",
      "to": "2012-10-04T09:53:55-05:00"
    },
    {
      "from": "2012-10-04T09:53:55-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>OK.</p>\n    </div>",
      "to": "2012-10-04T09:53:56-05:00"
    },
    {
      "from": "2012-10-04T09:53:56-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let's let him respond to this specific on Dodd-Frank and what the governor just said.</p>\n    </div>",
      "to": "2012-10-04T09:54:03-05:00"
    },
    {
      "from": "2012-10-04T09:54:03-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, I think this is a great example. The reason we have been in such a enormous economic crisis was prompted by reckless behavior across the board. Now, it wasn't just on Wall Street. You had -- loan officers were -- they were giving loans and mortgages that really shouldn't have been given, because they're -- the folks didn't qualify. You had people who were borrowing money to buy a house that they couldn't afford. You had credit agencies that were stamping these as A-1 (ph) great investments when they weren't. But you also had banks making money hand-over-fist, churning out products that the bankers themselves didn't even understand in order to make big profits, but knowing that it made the entire system vulnerable.</p>\n    </div>",
      "to": "2012-10-04T09:54:52-05:00"
    },
    {
      "from": "2012-10-04T09:54:52-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>So what did we do? We stepped in and had the toughest reforms on Wall Street since the 1930s. We said you've got -- banks, you've got to raise your capital requirements. You can't engage in some of this risky behavior that is putting Main Street at risk. We're going to make sure that you've got to have a living will, so -- so we can know how you're going to wind things down if you make a bad bet so we don't have other taxpayer bailouts.</p>\n    </div>",
      "to": "2012-10-04T09:55:16-05:00"
    },
    {
      "from": "2012-10-04T09:55:16-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>In the meantime, by the way, we also made sure that all the help that we provided those banks was paid back, every single dime, with interest.</p>\n    </div>",
      "to": "2012-10-04T09:55:26-05:00"
    },
    {
      "from": "2012-10-04T09:55:26-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Now, Governor Romney has said he wants to repeal Dodd-Frank, and, you know, I appreciate, and it appears we've got some agreement that a marketplace to work has to have some regulation, but in the past, Governor Romney has said he just wants to repeal Dodd-Frank, roll it back. And so the question is does anybody out there think that the big problem we had is that there was too much oversight and regulation of Wall Street? Because if you do, then Governor Romney is your candidate. But that's not what I believe.</p>\n    </div>",
      "to": "2012-10-04T09:56:01-05:00"
    },
    {
      "from": "2012-10-04T09:56:01-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>(Inaudible) -- sorry, Jim. That -- that's just not -- that's just not the facts. Look, we have to have regulation of Wall Street.</p>\n    </div>",
      "to": "2012-10-04T09:56:07-05:00"
    },
    {
      "from": "2012-10-04T09:56:07-05:00",
      "speaker": null,
      "sub": "",
      "to": "2012-10-04T09:56:06-05:00"
    },
    {
      "from": "2012-10-04T09:56:06-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Yeah.</p>\n    </div>",
      "to": "2012-10-04T09:56:07-05:00"
    },
    {
      "from": "2012-10-04T09:56:07-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>That -- that's why I'd have regulation. <span>But I wouldn't designate five banks as too big to fail and give them a blank check. That's one of the unintended consequences of Dodd-Frank.</span> It wasn't thought through properly. We need to get rid of that provision, because it's killing regional and small banks. They're getting hurt.</p>\n    </div>",
      "to": "2012-10-04T09:56:22-05:00"
    },
    {
      "from": "2012-10-04T09:56:22-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let me mention another regulation of Dodd-Frank. You say we were giving mortgages to people who weren't qualified. That's exactly right. It's one of the reasons for the great financial calamity we had. And so Dodd-Frank correctly says we need to --</p>\n    </div>",
      "to": "2012-10-04T09:56:34-05:00"
    },
    {
      "from": "2012-10-04T09:56:34-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>All right.</p>\n    </div>",
      "to": "2012-10-04T09:56:35-05:00"
    },
    {
      "from": "2012-10-04T09:56:35-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>-- have qualified mortgages, and if you give a mortgage that's not qualified, there are big penalties. Except they didn't ever go on to define what a qualified mortgage was.</p>\n    </div>",
      "to": "2012-10-04T09:56:43-05:00"
    },
    {
      "from": "2012-10-04T09:56:43-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>All right.</p>\n    </div>",
      "to": "2012-10-04T09:56:44-05:00"
    },
    {
      "from": "2012-10-04T09:56:44-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>It's been two years. We don't know what a qualified mortgage is yet. So banks are reluctant to make loans, mortgages. Try and get a mortgage these days. It's hurt the housing market --</p>\n    </div>",
      "to": "2012-10-04T09:56:54-05:00"
    },
    {
      "from": "2012-10-04T09:56:54-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>All right --</p>\n    </div>",
      "to": "2012-10-04T09:56:55-05:00"
    },
    {
      "from": "2012-10-04T09:56:55-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>-- because Dodd-Frank didn't anticipate putting in place the kinds of regulations you have to have. It's not that Dodd- Frank always was wrong with too much regulation. Sometimes they  didn't come out with a clear regulation.</p>\n    </div>",
      "to": "2012-10-04T09:57:08-05:00"
    },
    {
      "from": "2012-10-04T09:57:08-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>OK.</p>\n    </div>",
      "to": "2012-10-04T09:57:09-05:00"
    },
    {
      "from": "2012-10-04T09:57:09-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>I will make sure we don't hurt the functioning of our -- of our marketplace and our businesses, because I want to bring back housing and get good jobs.</p>\n    </div>",
      "to": "2012-10-04T09:57:14-05:00"
    },
    {
      "from": "2012-10-04T09:57:14-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>All right, I think we have another clear difference between the two of you. Now let's move to health care, where I know there is a clear difference -- (laughter) -- and that has to do with the Affordable Care Act, \"Obamacare.\"</p>\n    </div>",
      "to": "2012-10-04T09:57:28-05:00"
    },
    {
      "from": "2012-10-04T09:57:28-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And it's a two-minute new segment, and it's -- that means two minutes each. And you go first, Governor Romney. You wanted repeal. You want the Affordable Care Act repealed. Why?</p>\n    </div>",
      "to": "2012-10-04T09:57:39-05:00"
    },
    {
      "from": "2012-10-04T09:57:39-05:00",
      "speaker": null,
      "sub": "",
      "to": "2012-10-04T09:57:39-05:00"
    },
    {
      "from": "2012-10-04T09:57:39-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p><span>I sure do.</span> Well, in part, it comes, again, from my experience. I was in New Hampshire. A woman came to me, and she said, look, I can't afford insurance for myself or my son. I met a couple in Appleton, Wisconsin, and they said, we're thinking of dropping our insurance; we can't afford it. And the number of small businesses I've gone to that are saying they're dropping insurance because they can't afford it -- the cost of health care is just prohibitive. And -- and we've got to deal with cost.</p>\n    </div>",
      "to": "2012-10-04T09:58:06-05:00"
    },
    {
      "from": "2012-10-04T09:58:06-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And unfortunately, when -- when you look at \"Obamacare,\" the Congressional Budget Office has said it will cost $2,500 a year more than traditional insurance. So it's adding to cost. And as a matter of fact, when the president ran for office, he said that by this year he would have brought down the cost of insurance for each family by $2,500 a family. Instead, it's gone up by that amount. So it's expensive. Expensive things hurt families. So that's one reason I don't want it.</p>\n    </div>",
      "to": "2012-10-04T09:58:35-05:00"
    },
    {
      "from": "2012-10-04T09:58:35-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Second reason, it cuts $716 billion from Medicare to pay for it. I want to put that money back in Medicare for our seniors.</p>\n    </div>",
      "to": "2012-10-04T09:58:43-05:00"
    },
    {
      "from": "2012-10-04T09:58:43-05:00",
      "speaker": null,
      "sub": "",
      "to": "2012-10-04T09:58:43-05:00"
    },
    {
      "from": "2012-10-04T09:58:43-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p><span>Number three, it puts in place an unelected board that's going to tell people, ultimately, what kind of treatments they can have. I don't like that idea.</span></p>\n    </div>",
      "to": "2012-10-04T09:58:51-05:00"
    },
    {
      "from": "2012-10-04T09:58:51-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Fourth, there was a survey done of small businesses across the country. It said, what's been the effect of \"Obamacare\" on your hiring plans? And three-quarters of them said, it makes us less likely to hire people. I just don't know how the president could have come into office, facing 23 million people out of work, rising unemployment, an economic crisis at the -- at the kitchen table and spent his energy and passion for two years fighting for \"Obamacare\" instead of fighting for jobs for the American people.</p>\n    </div>",
      "to": "2012-10-04T09:59:20-05:00"
    },
    {
      "from": "2012-10-04T09:59:20-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>It has killed jobs. And the best course for health care is to do what we did in my state, craft a plan at the state level that fits the needs of the state. And then let's focus on getting the costs down for people rather than raising it with the $2,500 additional premium.</p>\n    </div>",
      "to": "2012-10-04T09:59:38-05:00"
    },
    {
      "from": "2012-10-04T09:59:38-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Mr. President, the argument against repeal.</p>\n    </div>",
      "to": "2012-10-04T09:59:41-05:00"
    },
    {
      "from": "2012-10-04T09:59:41-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, four years ago when I was running for office I was traveling around and having those same conversations that Governor Romney talks about. And it wasn't just that small businesses were seeing costs skyrocket and they couldn't get affordable coverage even if they wanted to provide it to their employees; it wasn't just that this was the biggest driver of our federal deficit, our overall health care costs. But it was families who were worried about going bankrupt if they got sick -- millions of families, all across the country.</p>\n    </div>",
      "to": "2012-10-04T10:00:11-05:00"
    },
    {
      "from": "2012-10-04T10:00:11-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>If they had a pre-existing condition they might not be able to get coverage at all. If they did have coverage, insurance companies might impose an arbitrary limit. And so as a consequence, they're paying their premiums, somebody gets really sick, lo and behold they don't have enough money to pay the bills because the insurance companies say that they've hit the limit. So we did work on this alongside working on jobs, because this is part of making sure that middle-class families are secure in  this country.</p>\n    </div>",
      "to": "2012-10-04T10:00:43-05:00"
    },
    {
      "from": "2012-10-04T10:00:43-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And let me tell you exactly what \"Obamacare\" did. Number one, if you've got health insurance it doesn't mean a government take over. You keep your own insurance. You keep your own doctor. But it does say insurance companies can't jerk you around. They can't impose arbitrary lifetime limits. They have to let you keep your kid on their insurance -- your insurance plan till you're 26 years old. And it also says that they're -- you're going to have to get rebates if insurance companies are spending more on administrative costs and profits than they are on actual care.</p>\n    </div>",
      "to": "2012-10-04T10:01:21-05:00"
    },
    {
      "from": "2012-10-04T10:01:21-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Number two, if you don't have health insurance, we're essentially setting up a group plan that allows you to benefit from group rates that are typically 18 percent lower than if you're out there trying to get insurance on the individual market.</p>\n    </div>",
      "to": "2012-10-04T10:01:35-05:00"
    },
    {
      "from": "2012-10-04T10:01:35-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Now, the last point I'd make before --</p>\n    </div>",
      "to": "2012-10-04T10:01:38-05:00"
    },
    {
      "from": "2012-10-04T10:01:38-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Two minutes --</p>\n    </div>",
      "to": "2012-10-04T10:01:40-05:00"
    },
    {
      "from": "2012-10-04T10:01:40-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>-- before --</p>\n    </div>",
      "to": "2012-10-04T10:01:41-05:00"
    },
    {
      "from": "2012-10-04T10:01:41-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Two minutes is up, sir.</p>\n    </div>",
      "to": "2012-10-04T10:01:43-05:00"
    },
    {
      "from": "2012-10-04T10:01:43-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>No, I -- I think I've -- I had five seconds before you interrupted me -- was -- (laughter) -- that the irony is that we've seen this model work really well in Massachusetts, because Governor Romney did a good thing, working with Democrats in the state to set up what is essentially the identical model. And as a consequence, people are covered there. It hasn't destroyed jobs. And as a consequence, we now have a system in which we have the opportunity to start bringing down cost, as opposed to just --</p>\n    </div>",
      "to": "2012-10-04T10:02:19-05:00"
    },
    {
      "from": "2012-10-04T10:02:19-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Your five --</p>\n    </div>",
      "to": "2012-10-04T10:02:20-05:00"
    },
    {
      "from": "2012-10-04T10:02:20-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>-- leaving millions of people out in the cold.</p>\n    </div>",
      "to": "2012-10-04T10:02:22-05:00"
    },
    {
      "from": "2012-10-04T10:02:22-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Your five seconds went away a long time ago. (Laughter.)</p>\n    </div>",
      "to": "2012-10-04T10:02:24-05:00"
    },
    {
      "from": "2012-10-04T10:02:24-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>That --</p>\n    </div>",
      "to": "2012-10-04T10:02:25-05:00"
    },
    {
      "from": "2012-10-04T10:02:25-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>All right, Governor. Governor, tell the -- tell the president directly why you think what he just said is wrong about \"Obamacare.\"</p>\n    </div>",
      "to": "2012-10-04T10:02:32-05:00"
    },
    {
      "from": "2012-10-04T10:02:32-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, I did with my first statement.</p>\n    </div>",
      "to": "2012-10-04T10:02:33-05:00"
    },
    {
      "from": "2012-10-04T10:02:33-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>You did.</p>\n    </div>",
      "to": "2012-10-04T10:02:34-05:00"
    },
    {
      "from": "2012-10-04T10:02:34-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But I'll go on.</p>\n    </div>",
      "to": "2012-10-04T10:02:35-05:00"
    },
    {
      "from": "2012-10-04T10:02:35-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Please elaborate.</p>\n    </div>",
      "to": "2012-10-04T10:02:36-05:00"
    },
    {
      "from": "2012-10-04T10:02:36-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>I'll elaborate.</p>\n    </div>",
      "to": "2012-10-04T10:02:37-05:00"
    },
    {
      "from": "2012-10-04T10:02:37-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Exactly right.</p>\n    </div>",
      "to": "2012-10-04T10:02:38-05:00"
    },
    {
      "from": "2012-10-04T10:02:38-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>First of all, I like the way we did it in Massachusetts. I like the fact that in my state, we had Republicans and Democrats come together and work together. What you did instead was to push through a plan without a single Republican vote. As a matter of fact, when Massachusetts did something quite extraordinary, elected a Republican senator to stop \"Obamacare,\" you pushed it through anyway. So entirely on a partisan basis, instead of bringing America together and having a discussion on this important topic, you pushed through something that you and Nancy Pelosi and Harry Reid thought was the best answer and drove it through.</p>\n    </div>",
      "to": "2012-10-04T10:03:09-05:00"
    },
    {
      "from": "2012-10-04T10:03:09-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>What we did, in a legislature 87 percent Democrat, we worked together. Two hundred legislators in my legislature -- only two voted against the plan by the time we were finished.</p>\n    </div>",
      "to": "2012-10-04T10:03:19-05:00"
    },
    {
      "from": "2012-10-04T10:03:19-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>What were some differences?</p>\n    </div>",
      "to": "2012-10-04T10:03:21-05:00"
    },
    {
      "from": "2012-10-04T10:03:21-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>We didn't raise taxes. You've raised them by a trillion dollars under \"Obamacare.\" We didn't cut Medicare. Of course, we don't have Medicare, but we didn't cut Medicare by $716 billion. We didn't put in place a board that can tell people ultimately what treatments they're going to receive.</p>\n    </div>",
      "to": "2012-10-04T10:03:35-05:00"
    },
    {
      "from": "2012-10-04T10:03:35-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>We didn't -- we didn't also do something that I think a number of people across this country recognize, which is put -- put people in a position where they're going to lose the insurance they had and they wanted. Right now, the CBO says up to 20 million people will lose their insurance as \"Obamacare\" goes into effect next year. And likewise, a study by McKinsey &amp; Company of American businesses said 30 percent of them are anticipating dropping people from coverage. So for those reasons, for the tax, for Medicare, for this board and for people losing their insurance, this is why the American people don't want -- don't want \"Obamacare.\" It's why Republicans said, do not do this.</p>\n    </div>",
      "to": "2012-10-04T10:04:14-05:00"
    },
    {
      "from": "2012-10-04T10:04:14-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And the Republicans had a -- had a plan. They put a plan out. They put out a plan, a bipartisan plan. It was swept aside. I think something this big, this important has to be done in a bipartisan basis. And we have to have a president who can reach across the aisle and fashion important legislation with the input from both parties.</p>\n    </div>",
      "to": "2012-10-04T10:04:31-05:00"
    },
    {
      "from": "2012-10-04T10:04:31-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Governor Romney said this has to be done on a bipartisan basis. This was a bipartisan idea. In fact, it was a Republican idea.</p>\n    </div>",
      "to": "2012-10-04T10:04:39-05:00"
    },
    {
      "from": "2012-10-04T10:04:39-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And Governor Romney, at the beginning of this debate, wrote and said, what we did in Massachusetts could be a model for the nation. And I agree that the Democratic legislators in Massachusetts might have given some advice to Republicans in Congress about how to cooperate, but the fact of the matter is, we used the same advisers, and they say it's the same plan.</p>\n    </div>",
      "to": "2012-10-04T10:05:02-05:00"
    },
    {
      "from": "2012-10-04T10:05:02-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>It -- when Governor Romney talks about this board, for example -- unelected board that we've created -- what this is, is a group of health care experts, doctors, et cetera, to figure out how can we reduce the cost of care in the system overall, because the -- there are two ways of dealing with our health care crisis.</p>\n    </div>",
      "to": "2012-10-04T10:05:25-05:00"
    },
    {
      "from": "2012-10-04T10:05:25-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>One is to simply leave a whole bunch of people uninsured and let them fend for themselves, to let businesses figure out how long they can continue to pay premiums until finally they just give up and their workers are no longer getting insured, and that's been the trend line. Or, alternatively, we can figure out how do we make the cost of care more effective. And there are ways of doing it.</p>\n    </div>",
      "to": "2012-10-04T10:05:47-05:00"
    },
    {
      "from": "2012-10-04T10:05:47-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>So at -- at Cleveland Clinic, one of the best health care systems in the world, they actually provide great care cheaper than average. And the reason they do is because they do some smart things. They -- they say, if a patient's coming in, let's get all the doctors together at once, do one test instead of having the patient run around with 10 tests. Let's make sure that we're providing preventive care so we're catching the onset of something like diabetes. Let's -- let's pay providers on the basis of performance as opposed to on the basis of how many procedures they've -- they've engaged in. Now, so what this board does is basically identifies best practices and says, let's use the purchasing power of Medicare and Medicaid to help to institutionalize all these good things that we do.</p>\n    </div>",
      "to": "2012-10-04T10:06:42-05:00"
    },
    {
      "from": "2012-10-04T10:06:42-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And the fact of the matter is that when \"Obamacare\" is fully implemented, we're going to be in a position to show that costs are going down. And over the last two years, health care premiums have gone up, it's true, but they've gone up slower than any time in the last 50 years. So we're already beginning to see progress. In the meantime, folks out there with insurance, you're already getting a rebate.</p>\n    </div>",
      "to": "2012-10-04T10:07:07-05:00"
    },
    {
      "from": "2012-10-04T10:07:07-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let me make one last point. Governor Romney says we should replace it. I'm just going to repeal it, but we can replace it with something. But the problem is he hasn't described what exactly we'd replace it with other than saying we're going to leave it to the states.</p>\n    </div>",
      "to": "2012-10-04T10:07:23-05:00"
    },
    {
      "from": "2012-10-04T10:07:23-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But the fact of the matter is that some of the prescriptions that he's offered, like letting you buy insurance across state lines, there's no indication that that somehow is going to help somebody who's got a pre-existing condition be able to finally buy insurance. In fact, it's estimated that by repealing \"Obamacare,\" you're looking at 50 million people losing health insurance at a time when it's vitally important.</p>\n    </div>",
      "to": "2012-10-04T10:07:46-05:00"
    },
    {
      "from": "2012-10-04T10:07:46-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let's let the governor explain what you would do if \"Obamacare\" is repealed. How would you replace it? What do you have in mind?</p>\n    </div>",
      "to": "2012-10-04T10:07:53-05:00"
    },
    {
      "from": "2012-10-04T10:07:53-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let -- well, actually -- actually it's -- it's -- it's a lengthy description, but number one, pre-existing conditions are covered under my plan. Number two, young people are able to stay on their family plan. That's already offered in the private marketplace; you don't have -- have the government mandate that for that to occur.</p>\n    </div>",
      "to": "2012-10-04T10:08:08-05:00"
    },
    {
      "from": "2012-10-04T10:08:08-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But let's come back to something the president -- I agree on, which is the -- the key task we have in health care is to get the costs down so it's more affordable for families, and -- and then he has as a model for doing that a board of people at the government, an unelected board, appointed board, who are going to decide what kind of treatment you ought to have.</p>\n    </div>",
      "to": "2012-10-04T10:08:28-05:00"
    },
    {
      "from": "2012-10-04T10:08:28-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>No, it isn't.</p>\n    </div>",
      "to": "2012-10-04T10:08:29-05:00"
    },
    {
      "from": "2012-10-04T10:08:29-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>In my opinion, the government is not effective in -- in bringing down the cost of almost anything. As a matter of fact, free people and free enterprises trying to find ways to do things  better are able to be more effective in bringing down the costs than the government will ever be. Your example of the Cleveland clinic is my case in point, along with several others I could describe. This is the private market. These are small -- these are enterprises competing with each other, learning how to do better and better jobs.</p>\n    </div>",
      "to": "2012-10-04T10:08:59-05:00"
    },
    {
      "from": "2012-10-04T10:08:59-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>I used to consult to businesses -- excuse me, to hospitals and to health care providers. I was astonished at the creativity and innovation that exists in the American people. In order to bring the cost of health care down, we don't need to have a -- an -- a board of 15 people telling us what kinds of treatments we should have. We instead need to put insurance plans, providers, hospitals, doctors on targets such that they have an incentive, as you say, performance pay, for doing an excellent job, for keeping costs down, and that's happening.</p>\n    </div>",
      "to": "2012-10-04T10:09:30-05:00"
    },
    {
      "from": "2012-10-04T10:09:30-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Intermountain Health Care does it superbly well.</p>\n    </div>",
      "to": "2012-10-04T10:09:33-05:00"
    },
    {
      "from": "2012-10-04T10:09:33-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>They do.</p>\n    </div>",
      "to": "2012-10-04T10:09:34-05:00"
    },
    {
      "from": "2012-10-04T10:09:34-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Mayo Clinic is doing it superbly well, Cleveland Clinic, others. But the right answer is not to have the federal government take over health care and start mandating to the providers across  America, telling a patient and a doctor what kind of treatment they can have. That's the wrong way to go. The private market and individual responsibility always work best.</p>\n    </div>",
      "to": "2012-10-04T10:09:55-05:00"
    },
    {
      "from": "2012-10-04T10:09:55-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let me just point out, first of all, this board that we're talking about can't make decisions about what treatments are given. That's explicitly prohibited in the law.</p>\n    </div>",
      "to": "2012-10-04T10:10:06-05:00"
    },
    {
      "from": "2012-10-04T10:10:06-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But let's go back to what Governor Romney indicated, that under his plan he would be able to cover people with pre-existing conditions. Well, actually, Governor, that isn't what your plan does. What your plan does is to duplicate what's already the law, which says if you are out of health insurance for three months then you can end up getting continuous coverage and an insurance company can't deny you if you've -- if it's been under 90 days.</p>\n    </div>",
      "to": "2012-10-04T10:10:40-05:00"
    },
    {
      "from": "2012-10-04T10:10:40-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But that's already the law. And that doesn't help the millions of people out there with pre-existing conditions. There's a reason why Governor Romney set up the plan that he did in Massachusetts. It wasn't a government takeover of health care. It was the largest expansion of private insurance. But what it does say is that insurers, you've got to take everybody. Now, that also means that you've got more customers.</p>\n    </div>",
      "to": "2012-10-04T10:11:05-05:00"
    },
    {
      "from": "2012-10-04T10:11:05-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But when Governor Romney says that he'll replace it with something but can't detail how it will be in fact replaced, and the reason he set up the system he did in Massachusetts is because there isn't a better way of dealing with the pre-existing conditions problem, it -- it just reminds me of -- you know, he says that he's going to close deductions and loopholes for his tax plan.</p>\n    </div>",
      "to": "2012-10-04T10:11:29-05:00"
    },
    {
      "from": "2012-10-04T10:11:29-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>That's how it's going to be paid for. But we don't know the details. He says that he's going to replace Dodd-Frank, Wall Street reform. But we don't know exactly which ones. He won't tell us. He now says he's going to replace \"Obamacare\" and assure that all the good things that are in it are going to be in there and you don't have to worry.</p>\n    </div>",
      "to": "2012-10-04T10:11:50-05:00"
    },
    {
      "from": "2012-10-04T10:11:50-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And at some point, I think the American people have to ask themselves, is the reason that Governor Romney is keeping all these plans to replace secret because they're too good? Is -- is it because that somehow middle-class families are going to benefit too much from them? No, the -- the reason is because when we reform Wall Street, when we tackle the problem of pre-existing conditions, then, you know, these are tough problems, and we've got to make choices. And the choices we've made have been ones that ultimately are benefiting middle-class families all across the country.</p>\n    </div>",
      "to": "2012-10-04T10:12:24-05:00"
    },
    {
      "from": "2012-10-04T10:12:24-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>All right, we're going to move to a --</p>\n    </div>",
      "to": "2012-10-04T10:12:26-05:00"
    },
    {
      "from": "2012-10-04T10:12:26-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>No, I -- I have to respond to that --</p>\n    </div>",
      "to": "2012-10-04T10:12:27-05:00"
    },
    {
      "from": "2012-10-04T10:12:27-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>No, but --</p>\n    </div>",
      "to": "2012-10-04T10:12:28-05:00"
    },
    {
      "from": "2012-10-04T10:12:28-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>-- which is -- which is my experience as a governor is if I come in and -- and lay down a piece of legislation and say it's my way or the highway, I don't get a lot done. What I do is the same way that Tip O'Neill and Ronald Reagan worked together some years ago. When Ronald Reagan ran for office, he laid out the principles that he was going to foster. He said he was going to lower tax rates. He said he was going to broaden the base. You've said the same thing: You're going to simplify the tax code, broaden the base. Those are my principles.</p>\n    </div>",
      "to": "2012-10-04T10:12:56-05:00"
    },
    {
      "from": "2012-10-04T10:12:56-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>I want to bring down the tax burden on middle-income families. And I'm going to work together with Congress to say, OK, what are the various ways we could bring down deductions, for instance? One way, for instance, would be to have a single number. Make up a number -- 25,000 (dollars), $50,000. Anybody can have deductions up to that amount. And then that number disappears for high-income people. That's one way one could do it. One could follow Bowles-Simpson as a model and take deduction by deduction and make differences that way.</p>\n    </div>",
      "to": "2012-10-04T10:13:22-05:00"
    },
    {
      "from": "2012-10-04T10:13:22-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>There are alternatives to accomplish the objective I have, which is to bring down rates, broaden the base, simplify the code and create incentives for growth.</p>\n    </div>",
      "to": "2012-10-04T10:13:32-05:00"
    },
    {
      "from": "2012-10-04T10:13:32-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And with regards to health care, you had remarkable details with regards to my pre-existing condition plan. You obviously studied up on -- on my plan. In fact, I do have a plan that deals with people with pre-existing conditions. That's part of my health care plan. And what we did in Massachusetts is a model for the nation, state by state. And I said that at that time. The federal government taking over health care for the entire nation and whisking aside the 10th Amendment, which gives states the rights for these kinds of things, is not the course for America to have a stronger, more vibrant economy.</p>\n    </div>",
      "to": "2012-10-04T10:14:04-05:00"
    },
    {
      "from": "2012-10-04T10:14:04-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>That is a terrific segue to our next segment, and is the role of government. And let's see, role of government and it is -- you are first on this, Mr. President. The question is this. Do you believe -- both of you -- but you have the first two minutes on this, Mr. President -- do you believe there's a fundamental difference between the two of you as to how you view the mission of the federal government?</p>\n    </div>",
      "to": "2012-10-04T10:14:34-05:00"
    },
    {
      "from": "2012-10-04T10:14:34-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, I definitely think there are differences.</p>\n    </div>",
      "to": "2012-10-04T10:14:37-05:00"
    },
    {
      "from": "2012-10-04T10:14:37-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And -- yeah.</p>\n    </div>",
      "to": "2012-10-04T10:14:39-05:00"
    },
    {
      "from": "2012-10-04T10:14:39-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>The first role of the federal government is to keep the American people safe. That's its most basic function. And as commander in chief, that is something that I've worked on and thought about every single day that I've been in the Oval Office.</p>\n    </div>",
      "to": "2012-10-04T10:14:55-05:00"
    },
    {
      "from": "2012-10-04T10:14:55-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But I also believe that government has the capacity -- the federal government has the capacity to help open up opportunity and create ladders of opportunity and to create frameworks where the American people can succeed. Look, the genius of America is the free enterprise system, and freedom, and the fact that people can go out there and start a business, work on an idea, make their own decisions.</p>\n    </div>",
      "to": "2012-10-04T10:15:22-05:00"
    },
    {
      "from": "2012-10-04T10:15:22-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But as Abraham Lincoln understood, there are also some things we do better together.</p>\n    </div>",
      "to": "2012-10-04T10:15:28-05:00"
    },
    {
      "from": "2012-10-04T10:15:28-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>So in the middle of the Civil War, Abraham Lincoln said, let's help to finance the Transcontinental Railroad. Let's start the National Academy of Sciences. Let's start land grant colleges, because we want to give these gateways of opportunity for all Americans, because if all Americans are getting opportunity, we're all going to be better off. That doesn't restrict people's freedom; that enhances it.</p>\n    </div>",
      "to": "2012-10-04T10:15:56-05:00"
    },
    {
      "from": "2012-10-04T10:15:56-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And so what I've tried to do as president is to apply those same principles. And when it comes to education, what I've said is we've got to reform schools that are not working. We use something called Race to the Top. Wasn't a top-down approach, Governor. What we've said is to states, we'll give you more money if you initiate reforms. And as a consequence, you had 46 states around the country who have made a real difference.</p>\n    </div>",
      "to": "2012-10-04T10:16:22-05:00"
    },
    {
      "from": "2012-10-04T10:16:22-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But what I've also said is let's hire another hundred thousand math and science teachers to make sure we maintain our technological lead and our people are skilled and able to succeed. And hard-pressed states right now can't all do that. In fact, we've seen layoffs of hundreds of thousands of teachers over the last several years, and Governor Romney doesn't think we need more teachers. I do, because I think that that is the kind of investment where the federal government can help. It can't do it all, but it can make a difference, and as a consequence, we'll have a better-trained workforce, and that will create jobs, because companies want to locate in places where we've got a skilled workforce.</p>\n    </div>",
      "to": "2012-10-04T10:17:01-05:00"
    },
    {
      "from": "2012-10-04T10:17:01-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Two minutes, Governor, on the role of government, your view.</p>\n    </div>",
      "to": "2012-10-04T10:17:03-05:00"
    },
    {
      "from": "2012-10-04T10:17:03-05:00",
      "speaker": null,
      "sub": "",
      "to": "2012-10-04T10:17:03-05:00"
    },
    {
      "from": "2012-10-04T10:17:03-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, first, I love great schools. <span>Massachusetts, our schools are ranked number one of all 50 states.</span> And the key to great schools: great teachers. So I reject the idea that I don't believe in great teachers or more teachers. Every school district, every state should make that decision on their own.</p>\n    </div>",
      "to": "2012-10-04T10:17:18-05:00"
    },
    {
      "from": "2012-10-04T10:17:18-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>The role of government -- look behind us: the Constitution and the Declaration of Independence.</p>\n    </div>",
      "to": "2012-10-04T10:17:24-05:00"
    },
    {
      "from": "2012-10-04T10:17:24-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>The role of government is to promote and protect the principles of those documents. First, life and liberty. We have a responsibility to protect the lives and liberties of our people, and that means the military, second to none. I do not believe in cutting our military. I believe in maintaining the strength of America's military.</p>\n    </div>",
      "to": "2012-10-04T10:17:45-05:00"
    },
    {
      "from": "2012-10-04T10:17:45-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Second, in that line that says, we are endowed by our Creator with our rights -- I believe we must maintain our commitment to religious tolerance and freedom in this country. That statement also says that we are endowed by our Creator with the right to pursue happiness as we choose. I interpret that as, one, making sure that those people who are less fortunate and can't care for themselves are cared by -- by one another.</p>\n    </div>",
      "to": "2012-10-04T10:18:10-05:00"
    },
    {
      "from": "2012-10-04T10:18:10-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>We're a nation that believes we're all children of the same God. And we care for those that have difficulties -- those that are elderly and have problems and challenges, those that disabled, we care for them. And we look for discovery and innovation, all these thing desired out of the American heart to provide the pursuit of happiness for our citizens.</p>\n    </div>",
      "to": "2012-10-04T10:18:28-05:00"
    },
    {
      "from": "2012-10-04T10:18:28-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But we also believe in maintaining for individuals the right to pursue their dreams, and not to have the government substitute itself for the rights of free individuals. And what we're seeing right now is, in my view, a -- a trickle-down government approach which has government thinking it can do a better job than free people pursuing their dreams. And it's not working.</p>\n    </div>",
      "to": "2012-10-04T10:18:49-05:00"
    },
    {
      "from": "2012-10-04T10:18:49-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And the proof of that is 23 million people out of work. The proof of that is one out of six people in poverty. The proof of that is we've gone from 32 million on food stamps to 47 million on food stamps. The proof of that is that 50 percent of college graduates this year can't find work.</p>\n    </div>",
      "to": "2012-10-04T10:19:05-05:00"
    },
    {
      "from": "2012-10-04T10:19:05-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>(Inaudible) --</p>\n    </div>",
      "to": "2012-10-04T10:19:06-05:00"
    },
    {
      "from": "2012-10-04T10:19:06-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>We know that the path we're taking is not working. It's time for a new path.</p>\n    </div>",
      "to": "2012-10-04T10:19:10-05:00"
    },
    {
      "from": "2012-10-04T10:19:10-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>All right, let's go through some specifics in terms of what -- how each of you views the role of government. How do -- education. Does the federal government have a responsibility to improve the quality of public education in America?</p>\n    </div>",
      "to": "2012-10-04T10:19:23-05:00"
    },
    {
      "from": "2012-10-04T10:19:23-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, the primary responsibility for education is -- is of course at the state and local level. But the federal government also can play a very important role. And I -- and I agree with Secretary Arne Duncan. He's -- there's some ideas he's put forward on Race to the Top -- not all of them but some of them I agree with, and congratulate him for pursuing that. The federal government can get local and -- and state schools to do a better job.</p>\n    </div>",
      "to": "2012-10-04T10:19:43-05:00"
    },
    {
      "from": "2012-10-04T10:19:43-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>My own view, by the way, is I've added to that. I happen to believe -- I want the kids that are getting federal dollars from IDEA or -- or Title I -- these are disabled kids or -- or poor kids or -- or lower-income kids, rather. I want them to be able to go to the school of their choice. So all federal funds, instead of going to the -- to the state or to the school district, I'd have go -- if you will, follow the child and let the parent and the child decide where to send their -- their -- their student.</p>\n    </div>",
      "to": "2012-10-04T10:20:10-05:00"
    },
    {
      "from": "2012-10-04T10:20:10-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>How do you see the federal government's responsibility to -- as I say, to improve the quality of public education in this country?</p>\n    </div>",
      "to": "2012-10-04T10:20:16-05:00"
    },
    {
      "from": "2012-10-04T10:20:16-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, as I've indicated, I think that it has a significant role to play. Through our Race to the Top program, we've worked with Republican and Democratic governors to initiate major reforms, and they're having an impact right now.</p>\n    </div>",
      "to": "2012-10-04T10:20:28-05:00"
    },
    {
      "from": "2012-10-04T10:20:28-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Do you think you have a difference with your views and those of Governor Romney on -- about education and the federal government?</p>\n    </div>",
      "to": "2012-10-04T10:20:34-05:00"
    },
    {
      "from": "2012-10-04T10:20:34-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>You know, this is where budgets matter because budgets reflect choices. So when Governor Romney indicates that he wants to cut taxes and potentially benefit folks like me and him, and to pay for it, we're having to initiate significant cuts in federal support for education, that makes a difference.</p>\n    </div>",
      "to": "2012-10-04T10:20:59-05:00"
    },
    {
      "from": "2012-10-04T10:20:59-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>You know, his running mate, Congressman Ryan, put forward a budget that reflects many of the principles that Governor Romney's talked about. And it wasn't very detailed. This seems to be a trend. But -- but what it did do is to -- if you extrapolated how much money we're talking about, you'd look at cutting the education budget by up to 20 percent.</p>\n    </div>",
      "to": "2012-10-04T10:21:21-05:00"
    },
    {
      "from": "2012-10-04T10:21:21-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>When it comes to community colleges, we are seeing great work done out there all over the country because we have the opportunity to train people for jobs that exist right now. And one of the things I suspect Governor Romney and I probably agree on is getting businesses to work with community colleges so that they're setting up their training programs --</p>\n    </div>",
      "to": "2012-10-04T10:21:40-05:00"
    },
    {
      "from": "2012-10-04T10:21:40-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Do you agree, Governor?</p>\n    </div>",
      "to": "2012-10-04T10:21:42-05:00"
    },
    {
      "from": "2012-10-04T10:21:42-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let -- let -- let me just finish the point.</p>\n    </div>",
      "to": "2012-10-04T10:21:43-05:00"
    },
    {
      "from": "2012-10-04T10:21:43-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Oh, yeah. Oh, yeah.</p>\n    </div>",
      "to": "2012-10-04T10:21:45-05:00"
    },
    {
      "from": "2012-10-04T10:21:45-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>I suspect it'll be a small agreement.</p>\n    </div>",
      "to": "2012-10-04T10:21:46-05:00"
    },
    {
      "from": "2012-10-04T10:21:46-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>It's going over well in my state, by the way, yeah.</p>\n    </div>",
      "to": "2012-10-04T10:21:47-05:00"
    },
    {
      "from": "2012-10-04T10:21:47-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>The -- where their partnering so that -- they're designing training programs, and people who are going through them know that there's a job waiting for them if they complete them. That makes a big difference. But that requires some federal support.</p>\n    </div>",
      "to": "2012-10-04T10:22:01-05:00"
    },
    {
      "from": "2012-10-04T10:22:01-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Let me just say one final example. When it comes to making college affordable -- whether it's two-year or four-year -- one of the things that I did as president was we were sending $60 billion to banks and lenders as middle men for the student loan program, even though the loans were guaranteed. So there was no risk for the banks or the lenders but they were taking billions out of the system.</p>\n    </div>",
      "to": "2012-10-04T10:22:24-05:00"
    },
    {
      "from": "2012-10-04T10:22:24-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And we said, why not cut out the middle man? And as a consequence, what we've been able to do is to provide millions more students assistance, lower or keep low interest rates on student loans. And this is an example of where our priorities make a difference. Governor Romney, I genuinely believe, cares about education. But when he tells a student that, you know, you should borrow money from your parents to go to college, you know, that indicates the degree to which, you know, there may not be as much of a focus on the fact that folks like myself, folks like Michelle, kids probably who attend University of Denver just don't have that option.</p>\n    </div>",
      "to": "2012-10-04T10:23:08-05:00"
    },
    {
      "from": "2012-10-04T10:23:08-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And for us to be able to make sure that they've got that opportunity and they can walk through that door, that is vitally important -- not just to those kids. It's how we're going to grow this economy over the long term.</p>\n    </div>",
      "to": "2012-10-04T10:23:19-05:00"
    },
    {
      "from": "2012-10-04T10:23:19-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>We're running out of time.</p>\n    </div>",
      "to": "2012-10-04T10:23:20-05:00"
    },
    {
      "from": "2012-10-04T10:23:20-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Jim, Jim --</p>\n    </div>",
      "to": "2012-10-04T10:23:22-05:00"
    },
    {
      "from": "2012-10-04T10:23:22-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>I'm certainly going give you a chance to respond to that. Yes, sir, Governor.</p>\n    </div>",
      "to": "2012-10-04T10:23:24-05:00"
    },
    {
      "from": "2012-10-04T10:23:24-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Mr. -- Mr. President, you're entitled, as the president, to your own airplane and to your own house, but not to your own facts -- (laughter) -- all right? I'm -- I'm not going to cut education funding. I don't have any plan to cut education funding and grants that go to people going to college. I'm planning on continuing to grow, so I'm not planning on making changes there.</p>\n    </div>",
      "to": "2012-10-04T10:23:40-05:00"
    },
    {
      "from": "2012-10-04T10:23:40-05:00",
      "speaker": null,
      "sub": "",
      "to": "2012-10-04T10:23:40-05:00"
    },
    {
      "from": "2012-10-04T10:23:40-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But you make a very good point, which is that the -- the place you put your money makes a pretty clear indication of where your heart is. You put $90 billion into -- into green jobs. And -- and I -- look, I'm all in favor of green energy. Ninety billion (dollars) -- that -- that would have -- that would have hired 2 million teachers. Ninety billion dollars. And these businesses -- many of them have gone out of business. <span>I think about half of them, of the ones have been invested in, they've gone out of business</span>. A number of them happened to be owned by -- by people who were contributors to your campaigns.</p>\n    </div>",
      "to": "2012-10-04T10:24:11-05:00"
    },
    {
      "from": "2012-10-04T10:24:11-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Look, the right course for -- for America's government -- we were talking about the role of government -- is not to become the economic player picking winners and losers, telling people what kind of health treatment they can receive, taking over the health care system that -- that has existed in this country for -- for a long, long time and has produced the best health records in the world. The right answer for government is to say, how do we make the private sector become more efficient and  more effective?</p>\n    </div>",
      "to": "2012-10-04T10:24:37-05:00"
    },
    {
      "from": "2012-10-04T10:24:37-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>How do we get schools to be more competitive? Let's grade them. I propose we grade our schools so parents know which schools are succeeding and failing, so they can take their child to a -- to a school that's being more successful. I don't -- I don't want to cut our commitment to education; I wanted to make it more effective and efficient.</p>\n    </div>",
      "to": "2012-10-04T10:24:53-05:00"
    },
    {
      "from": "2012-10-04T10:24:53-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And by the way, I've had that experience. I don't just talk about it. I've been there. Massachusetts schools are ranked number one in the nation. This is not because I didn't have commitment to education. It's because I care about education for all of our kids.</p>\n    </div>",
      "to": "2012-10-04T10:25:08-05:00"
    },
    {
      "from": "2012-10-04T10:25:08-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>All right, gentlemen, look --</p>\n    </div>",
      "to": "2012-10-04T10:25:09-05:00"
    },
    {
      "from": "2012-10-04T10:25:09-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Jim, I -- (inaudible) --</p>\n    </div>",
      "to": "2012-10-04T10:25:10-05:00"
    },
    {
      "from": "2012-10-04T10:25:10-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Excuse me, one sec -- excuse, me sir. (Laughter.) We've got -- we've got -- barely have three minutes left. I'm not going to grade the two of you and say you've -- your answers have been too long or I've done a poor job --</p>\n    </div>",
      "to": "2012-10-04T10:25:21-05:00"
    },
    {
      "from": "2012-10-04T10:25:21-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>You've done a great job, Jim.</p>\n    </div>",
      "to": "2012-10-04T10:25:22-05:00"
    },
    {
      "from": "2012-10-04T10:25:22-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Oh, well, no. But the fact is, government -- the role of government and governing, we've lost a (pod ?), in other words, so we only have three minutes left in the -- in the debate before  we go to your closing statements. And so I want to ask finally here -- and remember, we've got three minutes total time here.</p>\n    </div>",
      "to": "2012-10-04T10:25:44-05:00"
    },
    {
      "from": "2012-10-04T10:25:44-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And the question is this: Many of the legislative functions of the federal government right now are in a state of paralysis as a result of partisan gridlock. If elected in your case, if re-elected in your case, what would you do about that?</p>\n    </div>",
      "to": "2012-10-04T10:26:00-05:00"
    },
    {
      "from": "2012-10-04T10:26:00-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Governor?</p>\n    </div>",
      "to": "2012-10-04T10:26:01-05:00"
    },
    {
      "from": "2012-10-04T10:26:01-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Jim, I had the great experience -- it didn't seem like it at the time -- of being elected in a state where my legislature was 87 percent Democrat, and that meant I figured out from day one I had to get along and I had to work across the aisle to get anything done. We drove our schools to be number one in the nation. We cut taxes 19 times.</p>\n    </div>",
      "to": "2012-10-04T10:26:19-05:00"
    },
    {
      "from": "2012-10-04T10:26:19-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, what would you do as president?</p>\n    </div>",
      "to": "2012-10-04T10:26:20-05:00"
    },
    {
      "from": "2012-10-04T10:26:20-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>We -- as president, I will sit down on day one -- actually the day after I get elected, I'll sit down with leaders -- the Democratic leaders as well as Republican leaders and -- as we did in my state. We met every Monday for a couple hours, talked about the issues and the challenges in the -- in the -- in our state, in that case. We have to work on a collaborative basis -- not because we're going to compromise our principle(s), but because there's common ground.</p>\n    </div>",
      "to": "2012-10-04T10:26:43-05:00"
    },
    {
      "from": "2012-10-04T10:26:43-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And the challenges America faces right now -- look, the reason I'm in this race is there are people that are really hurting today in this country, and we face -- this deficit could crush the future generations. What's happening in the Middle East? There are developments around the world that are of real concern. And Republicans and Democrats both love America, but we need to have leadership -- leadership in Washington that will actually bring people together and get the job done and could not care less if it's a Republican or a Democrat. I've done it before. I'll do it again.</p>\n    </div>",
      "to": "2012-10-04T10:27:15-05:00"
    },
    {
      "from": "2012-10-04T10:27:15-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Mr. President.</p>\n    </div>",
      "to": "2012-10-04T10:27:16-05:00"
    },
    {
      "from": "2012-10-04T10:27:16-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, first of all, I think Governor Romney's going to have a busy first day, because he's also going to repeal \"Obamacare,\" which will not be very popular among Democrats as you're sitting down with them.</p>\n    </div>",
      "to": "2012-10-04T10:27:25-05:00"
    },
    {
      "from": "2012-10-04T10:27:25-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>But look, my philosophy has been I will take ideas from anybody, Democrat or Republican, as long as they're advancing the cause of making middle-class families stronger and giving ladders of opportunity into the middle class. That's how we cut taxes for middle-class families and small businesses. That's how we cut a trillion dollars of spending that wasn't advancing that cause. That's how we signed three trade deals into law that are helping us to double our exports and sell more American products around the world. That's how we repealed \"don't ask, don't tell.\" That's how we ended the war in Iraq, as I promised, and that's how we're going to wind down the war in Afghanistan. That's how we went after al-Qaida and bin Laden.</p>\n    </div>",
      "to": "2012-10-04T10:28:06-05:00"
    },
    {
      "from": "2012-10-04T10:28:06-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>So we've -- we've seen progress even under Republican control of the House of Representatives. But ultimately, part of being principled, part of being a leader is, A, being able to describe exactly what it is that you intend to do, not just saying, I'll sit down, but you have to have a plan.</p>\n    </div>",
      "to": "2012-10-04T10:28:25-05:00"
    },
    {
      "from": "2012-10-04T10:28:25-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Number two, what's important is occasionally you've got to say no to -- to -- to folks both in your own party and in the other party. And you know, yes, have we had some fights between me and the Republicans when they fought back against us, reining in the excesses of Wall Street? Absolutely, because that was a fight that needed to be had. When -- when we were fighting about whether or not we were going to make sure that Americans had more security with their health insurance and they said no, yes, that was a fight that we needed to have. And so part of leadership and governing is both saying what it is that you are for, but also being willing to say no to some things.</p>\n    </div>",
      "to": "2012-10-04T10:29:03-05:00"
    },
    {
      "from": "2012-10-04T10:29:03-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And I've got to tell you, Governor Romney, when it comes to his own party during the course of this campaign, has not displayed that willingness to say no to some of the more extreme parts of his party.</p>\n    </div>",
      "to": "2012-10-04T10:29:13-05:00"
    },
    {
      "from": "2012-10-04T10:29:13-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>That brings us to closing statements. There was a coin toss. Governor Romney, you won the toss, and you elected to go last.</p>\n    </div>",
      "to": "2012-10-04T10:29:22-05:00"
    },
    {
      "from": "2012-10-04T10:29:22-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>So you have a closing two minutes, Mr. President.</p>\n    </div>",
      "to": "2012-10-04T10:29:25-05:00"
    },
    {
      "from": "2012-10-04T10:29:25-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Well, Jim, I want to thank you and I want to thank Governor Romney, because I think this was a terrific debate and I very much appreciate it.</p>\n    </div>",
      "to": "2012-10-04T10:29:32-05:00"
    },
    {
      "from": "2012-10-04T10:29:32-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And I want to thank the University of Denver.</p>\n    </div>",
      "to": "2012-10-04T10:29:36-05:00"
    },
    {
      "from": "2012-10-04T10:29:36-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>You know, four years ago we were going through a major crisis, and yet my faith and confidence in the American future is undiminished. And the reason is because of its people. Because of the woman I met in North Carolina who decided at 55 to go back to school because she wanted to inspire her daughter, and now has a new job from that new training that she's gotten. Because of the company in Minnesota who was willing to give up salaries and perks for their executives to make sure that they didn't lay off workers during a recession. The auto workers that you meet in Toledo or Detroit take such pride in building the best cars in the world -- not just because of a paycheck, but because it gives them that sense of pride, that they're helping to build America.</p>\n    </div>",
      "to": "2012-10-04T10:30:24-05:00"
    },
    {
      "from": "2012-10-04T10:30:24-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And so the question now is, how do we build on those strengths? And everything that I've tried to do and everything that I'm now proposing for the next four years in terms of improving our education system, or developing American energy, or making sure that we're closing loopholes for companies that are shipping jobs overseas and focusing on small businesses and companies that are creating jobs here in the United States, or -- or closing our deficit in a responsible, balanced way that allows us to invest in our future -- all those things are designed to make sure that the American people, their genius, their grit, their determination is -- is channeled, and -- and -- and they have an opportunity to succeed.</p>\n    </div>",
      "to": "2012-10-04T10:31:04-05:00"
    },
    {
      "from": "2012-10-04T10:31:04-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And everybody's getting a fair shot and everybody's getting a fair share. Everybody's doing a fair share and everybody's playing by the same rules.</p>\n    </div>",
      "to": "2012-10-04T10:31:11-05:00"
    },
    {
      "from": "2012-10-04T10:31:11-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>You know, four years ago I said that I'm not a perfect man and I wouldn't be a perfect president. And that's probably a promise that Governor Romney thinks I've kept. But I also promised that I'd fight every single day on behalf of the American people and the middle class and all those who are striving to get in the middle class.</p>\n    </div>",
      "to": "2012-10-04T10:31:29-05:00"
    },
    {
      "from": "2012-10-04T10:31:29-05:00",
      "speaker": "President Obama",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>I've kept that promise and if you'll vote for me, then I promise I'll fight just as hard in a second term.</p>\n    </div>",
      "to": "2012-10-04T10:31:36-05:00"
    },
    {
      "from": "2012-10-04T10:31:36-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Governor Romney, your two-minute closing.</p>\n    </div>",
      "to": "2012-10-04T10:31:38-05:00"
    },
    {
      "from": "2012-10-04T10:31:38-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Thank you, Jim and Mr. President. And thank you for tuning in this evening. This is a -- this is an important election. And I'm concerned about America. I'm concerned about the direction America has been taking over the last four years. I know this is bigger than election about the two of us as individuals. It's bigger than our respective parties. It's an election about the course of America -- what kind of America do you want to have for yourself and for your children.</p>\n    </div>",
      "to": "2012-10-04T10:32:05-05:00"
    },
    {
      "from": "2012-10-04T10:32:05-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And there really are two very different paths that we began speaking about this evening. And over the course of this month we're going to have two more presidential debates and vice presidential debate. We'll talk about those two paths. But they lead in very different directions. And it's not just looking to our words that you have to take in evidence of where they go; you can look at the record.</p>\n    </div>",
      "to": "2012-10-04T10:32:21-05:00"
    },
    {
      "from": "2012-10-04T10:32:21-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>There's no question in my mind that if the president were to be re-elected you'll continue to see a middle-class squeeze with incomes going down and prices going up. I'll get incomes up again. You'll see chronic unemployment. We've had 43 straight months with unemployment above 8 percent. If I'm president, I will create -- help create 12 million new jobs in this country with rising incomes.</p>\n    </div>",
      "to": "2012-10-04T10:32:43-05:00"
    },
    {
      "from": "2012-10-04T10:32:43-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>If the president's re-elected, \"Obamacare\" will be fully installed. In my view, that's going to mean a whole different way of life for people who counted on the insurance plan they had in the past. Many will lose it. You're going to see health premiums go up by some $2,500 per -- per family. If I'm elected, we won't have \"Obamacare.\" We'll put in place the kind of principles that I put in place in my own state and allow each state to craft their own programs to get people insured. And we'll focus on getting the cost of health care down.</p>\n    </div>",
      "to": "2012-10-04T10:33:11-05:00"
    },
    {
      "from": "2012-10-04T10:33:11-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>If the president were to be re-elected, you're going to see a $716 billion cut to Medicare. You'll have 4 million people who will lose Medicare advantage. You'll have hospitals and providers that'll no longer accept Medicare patients.</p>\n    </div>",
      "to": "2012-10-04T10:33:23-05:00"
    },
    {
      "from": "2012-10-04T10:33:23-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>I'll restore that $716 billion to Medicare.</p>\n    </div>",
      "to": "2012-10-04T10:33:27-05:00"
    },
    {
      "from": "2012-10-04T10:33:27-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>And finally, military. If the president's re-elected, you'll see dramatic cuts to our military. The secretary of defense has said these would be even devastating. I will not cut our commitment to our military. I will keep America strong and get America's middle class working again.</p>\n    </div>",
      "to": "2012-10-04T10:33:43-05:00"
    },
    {
      "from": "2012-10-04T10:33:43-05:00",
      "speaker": "Mitt Romney",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Thank you, Jim.</p>\n    </div>",
      "to": "2012-10-04T10:33:44-05:00"
    },
    {
      "from": "2012-10-04T10:33:44-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Thank you, Governor.</p>\n    </div>",
      "to": "2012-10-04T10:33:45-05:00"
    },
    {
      "from": "2012-10-04T10:33:45-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>Thank you, Mr. President.</p>\n    </div>",
      "to": "2012-10-04T10:33:46-05:00"
    },
    {
      "from": "2012-10-04T10:33:46-05:00",
      "speaker": "Jim Lehrer",
      "sub": "<div class=\"nytmm_annotation_type_transcript_paragraph\">\n      \n      <p>The next debate will be the vice presidential event on Thursday, October 11th at Center College in Danville, Kentucky. For now, from the University of Denver, I'm Jim Lehrer. Thank you, and good night. (Cheers, applause.)</p>\n    </div>",
      "to": "2012-10-04T10:33:56-05:00"
    }
  ]
} ;


    torque.subtitles.clear = function () {
        $('.torque_subs').html('');
    };
    torque.subtitles.set = function (date) {
        $.each(this.subs, function () {            
        //             console.log(date);
        // console.log(date.toUTCString());
        // console.log(new Date(this.from));

            if (this.from < date && this.to > date) {
                torque.subtitles._update(this);
            }
        });
    };
    torque.subtitles._update = function (msg) {
        $('.torque_subs_speaker').html(msg.speaker);
        $('.torque_subs').html(msg.sub);
    };
};

/**
 * Logging module that torquetes log messages to the console and to the Speed
 * Tracer API. It contains convenience methods for info(), warn(), error(),
 * and todo().
 *
 */
Torque.modules.log = function (torque) {
    torque.log = {};

    torque.log.info = function (msg) {
        torque.log._torquete('INFO: ' + msg);
    };

    torque.log.warn = function (msg) {
        torque.log._torquete('WARN: ' + msg);
    };

    torque.log.error = function (msg) {
        torque.log._torquete('ERROR: ' + msg);
    };

    torque.log.todo = function (msg) {
        torque.log._torquete('TODO: ' + msg);
    };

    torque.log._torquete = function (msg) {
        var logger = window.console;
        if (torque.log.enabled) {
            if (logger && logger.markTimeline) {
                logger.markTimeline(msg);
            }
            console.log(msg);
        }
    };
};

var originShift = 2 * Math.PI * 6378137 / 2.0;
var initialResolution = 2 * Math.PI * 6378137 / 256.0;
function meterToPixels(mx, my, zoom) {
    var res = initialResolution / (1 << zoom);
    var px = (mx + originShift) / res;
    var py = (my + originShift) / res;
    return [px, py];
}