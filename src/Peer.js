module.exports = class Peer {
    constructor(socket_id, name, room_id, io) {
        this.id = socket_id
        this.name = name
        this.locked = false;
        this.io = io;
        this.room_id = room_id;
        this.transports = new Map()
        this.consumers = new Map()
        this.producers = new Map()
        this.blocks = new Set();
        this.allows = new Set();
    }


    addTransport(transport) {
        this.transports.set(transport.id, transport)
    }

    async connectTransport(transport_id, dtlsParameters) {
        if (!this.transports.has(transport_id)) return
        await this.transports.get(transport_id).connect({
            dtlsParameters: dtlsParameters
        });
    }

    async createProducer(producerTransportId, rtpParameters, kind, locked = false) {
        //TODO handle null errors
        this.locked = locked;
        let producer = await this.transports.get(producerTransportId).produce({
            kind,
            rtpParameters,
            appData: {
                locked
            }
        })

        this.producers.set(producer.id, producer)

        producer.on('transportclose', function() {
            console.log(`---producer transport close--- name: ${this.name} consumer_id: ${producer.id}`)
            producer.close()
            this.producers.delete(producer.id)
        }.bind(this))

        return producer
    }

    async createConsumer(consumer_transport_id, producer_id, rtpCapabilities) {
        let consumerTransport = this.transports.get(consumer_transport_id)
        let consumer = null
        try {
            consumer = await consumerTransport.consume({
                producerId: producer_id,
                rtpCapabilities,
                paused: false, //producer.kind === 'video',
            });
        } catch (error) {
            console.error('consume failed', consumer_transport_id);
            return;
        }

        if (consumer.type === 'simulcast') {
            await consumer.setPreferredLayers({
                spatialLayer: 2,
                temporalLayer: 2
            });
        }
        

        this.consumers.set(consumer.id, {
            consumer,
            producerId: producer_id,
        })

        // consumer.on('transportclose', function() {
        //     console.log(`---consumer transport close--- name: ${this.name} consumer_id: ${consumer.id}`)
        //     this.consumers.delete(consumer.id)
        // }.bind(this))

        

        return {
            consumer,
            params: {
                producerId: producer_id,
                id: consumer.id,
                name: this.name,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
                type: consumer.type,
                producerPaused: consumer.producerPaused,
                refused: false
            }
        }
    }

    closeProducer(producer_id) {
        try {
            this.producers.get(producer_id).close()
        } catch(e) {
            console.warn(e)
        }
    
        this.producers.delete(producer_id)
    }

    closeAllProducers() {
        console.log('all remove')
        try {
            this.producers.forEach((producer, key, map) => {
                producer.close();
            })
        } catch(e) {
            console.warn(e)
        }
        this.producers.clear();
    }


    getProducer(producer_id) {
        return this.producers.get(producer_id)
    }

    close() {
        this.transports.forEach(transport => transport.close())
        this.blocks.clear();
        this.allows.clear();
    }

    getProducerIdOfConsumer(consumer_id) {
        let consumerInfo = this.consumers.get(consumer_id);
        let producerId = null;
        if(consumerInfo) {
            producerId = consumerInfo.producerId;
            return producerId;
        }
        
    }
    removeConsumer(consumer_id) {
        // let consumerInfo = this.consumers.get(consumer_id);
        // let producerId = null;
        // if(consumerInfo) {
        //     producerId = consumerInfo.producerId;
        // }
        this.consumers.delete(consumer_id);
        return true;
    }

    addBlock(name) {
        this.blocks.add(name);
    }

    addAllow(name) {
        this.allows.add(name);
    }
    checkBlock(name) {
        if(this.blocks.has(name)) {
            return true;
        } else {
            return false;
        }
    }
    checkAllow(name) {
        if(this.allows.has(name)) {
            return true;
        } else {
            return false;
        }
    }
}