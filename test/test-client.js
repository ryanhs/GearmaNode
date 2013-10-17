var should     = require('should'),
    sinon      = require('sinon'),
    events     = require('events'),
    gearmanode = require('../lib/gearmanode'),
    lb         = require('../lib/gearmanode/load-balancing'),
    Client     = gearmanode.Client,
    Job        = gearmanode.Job,
    JobServer  = require('../lib/gearmanode/job-server').JobServer;


describe('Client', function() {
    var c, js;
    beforeEach(function() {
        c = gearmanode.client();
        c.emit = sinon.spy();
        js = c.jobServers[0];
    });


    describe('#factory', function() {
        it('should return default instance of Client', function() {
            c.should.be.an.instanceof(Client);
            c._type.should.equal('Client');
            should.exist(c.jobServers);
            should.exist(c.jobs);
            Object.keys(c.jobs).length.should.equal(0);
        })
        it('should return error when violated validation', function() {
            // duplicate servers
            c = gearmanode.client({ servers: [{host: 'localhost'}, {host: 'localhost'}] });
            c.should.be.an.instanceof(Error);
            // unknown load balancing strategy
            c = gearmanode.client({ loadBalancing: 'AlfaBravo' });
            c.should.be.an.instanceof(Error);
        })
        it('should set correct load balancer', function() {
            should.exist(c.loadBalancer);
            c.loadBalancer.should.be.an.instanceof(lb.Sequence);
            c = gearmanode.client({ loadBalancing: 'RoundRobin' });
            c.loadBalancer.should.be.an.instanceof(lb.RoundRobin);
        })
    })


    describe('#close', function() {
        it('should clean up object', function() {
            c.jobs['H:lima:207'] = new Job(c, { name: 'reverse', payload: 'hi' }); // mock the jobs
            c.on('submit', function() {});
            events.EventEmitter.listenerCount(c, 'submit').should.equal(1);
            Object.keys(c.jobs).length.should.equal(1);
            c.close();
            c.closed.should.be.true;
            Object.keys(c.jobs).length.should.equal(0);
            events.EventEmitter.listenerCount(c, 'submit').should.equal(0);
        })
        it('should emit event on itself', function() {
            c.close();
            c.emit.calledTwice.should.be.true; // diconnect + close
            c.emit.getCall(0).args[0].should.equal('disconnect');
            c.emit.getCall(1).args[0].should.equal('close');
        })
    })


    describe('#submit', function() {
        it('should return job instance', function() {
            var job = c.submitJob({name: 'reverse', payload: 'hi'});
            should.exist(job);
            job.should.be.an.instanceof(Job);
            job.name.should.equal('reverse');
            job.payload.should.equal('hi');
            job.name.should.equal('reverse');
            job.processing.should.be.true;
            job.jobServerUid.should.equal(js.getUid());
        })
        it('should set many managing values', function() {
            var job = c.submitJob({name: 'reverse', payload: 'hi'});
            js = c.jobServers[0];
            js.jobsWaiting4Created.length.should.equal(1);
            js.jobsWaiting4Created[0].should.equal(job);
        })
        it('should emit error if submiting fails', function(done) {
            c = gearmanode.client({port: 1});
            c.submitJob({name: 'reverse', payload: 'hi'});
            c.once('error', function(err) {
                should.exist(err);
                err.should.be.an.instanceof(Error);
                done();
            })
        })
    })


    describe('#_getJobServer', function() {
        it('should return JobServer according to Sequence balancing strategy', function() {
            c = gearmanode.client({ servers: [{port: 4730}, {port: 4731}] });
            c._getJobServer().should.equal(c.jobServers[0]);
            c._getJobServer().should.equal(c.jobServers[0]);
            c._getJobServer().should.equal(c.jobServers[0]);
        })
        it('should return JobServer according to RoundRobin balancing strategy', function() {
            c = gearmanode.client({ servers: [{port: 4730}, {port: 4731}], loadBalancing: 'RoundRobin' });
            c._getJobServer().should.equal(c.jobServers[0]);
            c._getJobServer().should.equal(c.jobServers[1]);
            c._getJobServer().should.equal(c.jobServers[0])
;        })
    })


    describe('#Job', function() {


        describe('#getStatus', function() {
            it('should send packet to job server', function() {
                var j = new Job(c, {name: 'NAME', payload: 'PAYLOAD', background: true});
                js.send = sinon.spy();
                j.handle = 'HANDLE';
                j.jobServerUid = js.getUid();
                j.getStatus();
                js.send.calledOnce.should.be.true;
            })
            it('should validate job to be background', function() {
                var j = new Job(c, {name: 'NAME', payload: 'PAYLOAD'});
                js.send = sinon.spy();
                j.getStatus(function(err) { err.should.be.an.instanceof(Error); })
                j.background = true;
                j.getStatus(function(err) { err.should.be.an.instanceof(Error); })
                j.handle = 'HANDLE';
                j.getStatus(function(err) { err.should.be.an.instanceof(Error); })
                j.jobServerUid = js.getUid();
                j.getStatus(function(err){});
                js.send.calledOnce.should.be.true;
            })
        })
    })


    describe('#LoadBalancer', function() {


        describe('#_getJobServer', function() {
            it('should return corresponding job server (Sequence)', function() {
                c = gearmanode.client({servers: [{port: 4730}, {port: 4731}]});
                c._getJobServer().should.equal(c.jobServers[0]);
                c._getJobServer().should.equal(c.jobServers[0]);
                c._getJobServer().should.equal(c.jobServers[0]);
            })
            it('should return corresponding job server (RoundRobin)', function() {
                c = gearmanode.client({servers: [{port: 4730}, {port: 4731}], loadBalancing: 'RoundRobin'});
                c._getJobServer().should.equal(c.jobServers[0]);
                c._getJobServer().should.equal(c.jobServers[1]);
                c._getJobServer().should.equal(c.jobServers[0]);
            })
            it('should emit error if all job server invalid', function() {
                c = gearmanode.client({port: 1});
                c.emit = sinon.spy();
                c.loadBalancer.badOne(0);
                c.emit.callCount.should.equal(0);
                c._getJobServer();
                c.emit.calledOnce.should.be.true;
            })
        })


        describe('#(error handling)', function() {
            it('should mark job server as bad when connection fails', function(done) {
                c = gearmanode.client({port: 1});
                c.emit = sinon.spy();
                c.loadBalancer.badOne = sinon.spy();
                c.jobServers[0].connect(function(err) {
                    should.exist(err);
                    err.should.be.an.instanceof(Error);
                    c.loadBalancer.badOne.calledOnce.should.be.true;
                    c.loadBalancer.badOne.calledWith(0).should.be.true;
                    c.emit.calledTwice.should.be.true; // error + disconnect
                    done();
                })

            })
        })
    })

})
