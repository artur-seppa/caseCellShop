import { Queue } from 'bullmq'
import { bullmqConnection } from '#start/bullmq_connection'

export const checkoutQueue = new Queue('checkout', {
  connection: bullmqConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
})
