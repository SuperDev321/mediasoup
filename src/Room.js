const config = require('./config');
module.exports = class Room {
    constructor(room_id, worker, io = null) {
        this.id = room_id
        const mediaCodecs = config.mediasoup.router.mediaCodecs
        worker.createRouter({
            mediaCodecs
        }).then(function (router) {
            this.router = router
        }.bind(this))

        this.peers = new Map()
        this.io = io
    }

    addPeer(peer) {
        this.peers.set(peer.id, peer)
    }

    getProducerListForPeer(socket_id) {
        let producerList = []
        this.peers.forEach(peer => {
            peer.producers.forEach(producer => {
                producerList.push({
                    producer_id: producer.id,
                    producer_name: peer.name,
                    producer_socket_id: peer.id,
                    room_id: this.id,
                    locked: peer.locked,
                    kind: producer._data.kind
                })
            })
        })
        return producerList
    }

    getRtpCapabilities() {
        return this.router.rtpCapabilities
    }

    async createWebRtcTransport(peer_id) {
        const {
            maxIncomingBitrate,
            initialAvailableOutgoingBitrate
        } = config.mediasoup.webRtcTransport;

        const transport = await this.router.createWebRtcTransport({
            listenIps: config.mediasoup.webRtcTransport.listenIps,
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate,
        });
        if (maxIncomingBitrate) {
            try {
                await transport.setMaxIncomingBitrate(maxIncomingBitrate);
            } catch (error) {}
        }

        transport.on('dtlsstatechange', function(dtlsState) {

            if (dtlsState === 'closed') {
                console.log('---transport close dtls--- ' + this.peers.get(peer_id).name + ' closed')
                transport.close()
            }
        }.bind(this))

        transport.on('close', () => {
            console.log('---transport close--- ' + this.peers.get(peer_id).name + ' closed')
        })
        console.log('---adding transport---', transport.id)
        this.peers.get(peer_id).addTransport(transport)
        return {
            params: {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters
            },
        };
    }

    async connectPeerTransport(socket_id, transport_id, dtlsParameters) {
        if (!this.peers.has(socket_id)) return
        await this.peers.get(socket_id).connectTransport(transport_id, dtlsParameters)

    }

    async produce(socket_id, producerTransportId, rtpParameters, kind, name, locked) {
        // handle undefined errors
        return new Promise(async function (resolve, reject) {
            let peer = await this.peers.get(socket_id);
            let producer = await peer.createProducer(producerTransportId, rtpParameters, kind, locked)
            resolve(producer.id)
            // this.broadCast(socket_id, 'newProducers', [{
            //     producer_id: producer.id,
            //     producer_socket_id: socket_id,
            //     producer_name: peer.name,
            //     room_id: this.id,
            //     locked
            // }])
        }.bind(this))
    }

    async consume(socket_id, consumer_transport_id, producer_id,  rtpCapabilities) {
        // handle nulls
        if (!this.router.canConsume({
                producerId: producer_id,
                rtpCapabilities,
            })) {
            console.error('can not consume');
            return;
        }
        console.log('--consume--', consumer_transport_id);
        let peer = this.peers.get(socket_id);
        if(peer) {
            let {consumer, params} = await this.peers.get(socket_id).createConsumer(consumer_transport_id, producer_id, rtpCapabilities)
            consumer.on('transportclose',async function() {
                console.log(`---consumer transport close--- name: ${this.name} consumer_id: ${consumer.id}`)
                // this.consumers.delete(consumer.id)
                await this.closeConsumer(socket_id, consumer.id);
            }.bind(this))
            consumer.on('producerclose', function(){
                console.log(`---consumer closed--- due to producerclose event  name:${this.peers.get(socket_id).name} consumer_id: ${consumer.id}`)
                this.peers.get(socket_id).removeConsumer(consumer.id)
                // tell client consumer is dead
                // this.io.to(socket_id)
                try {
                    socket.emit('consumerClosed', {
                        consumer_id: consumer.id,
                        room_id: this.id
                    })
                } catch (err) {
                    console.log(err.message)
                }
            }.bind(this))
            
            return params
        }
        return null;

    }

    async removePeer(socket_id) {
        this.peers.get(socket_id).close()
        this.peers.delete(socket_id)
    }

    closeProducer(socket_id, producer_id) {
        if (this.peers.has(socket_id))
        this.peers.get(socket_id).closeProducer(producer_id)
    }

    pauseProducer(socket_id, producer_id) {
        this.peers.get(socket_id).pauseProducer(producer_id);
    }

    resumeProducer(socket_id, producer_id) {
        this.peers.get(socket_id).resumeProducer(producer_id);
    }

    async closeConsumer(socket_id, consumer_id) {
        let peer = this.peers.get(socket_id);
        if(peer) {
            let name = peer.name;
            let producerId = peer.getProducerIdOfConsumer(consumer_id);
            let producerList = this.getProducerListForPeer();
            let producerInfo = producerList.find(({producer_id}) => (producer_id === producerId));
            if(producerInfo) {
                let {producer_socket_id, producer_id, producer_name, kind} = producerInfo;
                if(kind == 'video') {
                    this.io.to(producer_socket_id).emit('stop view', {
                        name,
                        producer_id: producerInfo.producer_id,
                        room_id: producerInfo.room_id
                    });
                }
            }
            peer.removeConsumer(consumer_id);
        }
        
    }

    closeAllProducers(socket_id) {
        this.peers.get(socket_id).closeAllProducers();
    }

    broadCast(socket_id, name, data) {
        for (let otherID of Array.from(this.peers.keys()).filter(id => id !== socket_id)) {
            this.send(otherID, name, data)
        }
        // let socket = this.io.get
        // this.io.to(this.id).emit(name, data);
    }

    send(socket_id, name, data) {
        this.io.to(socket_id).emit(name, data)
    }

    getPeers(){
        return this.peers
    }

    toJson() {
        return {
            id: this.id,
            peers: JSON.stringify([...this.peers])
        }
    }

    getPeerByName(name) {
        let id = null
        for (let [key, peer] of this.peers.entries()) {
            if (peer.name === name)
                id = key;
        }
        if (id) {
            return this.peers.get(id);
        } else {
            return null;
        }
    }
}