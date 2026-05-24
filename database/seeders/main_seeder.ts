import { BaseSeeder } from '@adonisjs/lucid/seeders'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { ulid } from 'ulid'

const now = () => DateTime.now().toSQL({ includeOffset: false })

/**
 * Well-known customer IDs for testing/documentation.
 * Use these IDs in the `customerId` field when calling POST /api/v1/checkout.
 */
export const SEED_CUSTOMERS = {
  alice: '01JVMN00000000000000TEST01',
  bob: '01JVMN00000000000000TEST02',
  charlie: '01JVMN00000000000000TEST03',
}

/**
 * Well-known product IDs.
 * Stable across runs so examples in README/docs always reference valid IDs.
 */
// Stable ULIDs for seed products — safe to use in README examples and curl scripts.
// Generated with: node -e "const {ulid}=require('ulid'); for(let i=0;i<10;i++) console.log(ulid())"
export const SEED_PRODUCT_IDS = {
  siliconeiPhone15:    '01JVPRD000000000000PRDC001',
  leatherGalaxyS24:   '01JVPRD000000000000PRDC002',
  clearIPhone14:       '01JVPRD000000000000PRDC003',
  ruggedMotoEdge40:    '01JVPRD000000000000PRDC004',
  siliconXiaomi13T:    '01JVPRD000000000000PRDC005',
  leatherPixel8:       '01JVPRD000000000000PRDC006',
  clearMagsafeiPhone15Pro: '01JVPRD000000000000PRDC007',
  ruggedGalaxyA54:     '01JVPRD000000000000PRDC008',
  siliconRedmiNote13:  '01JVPRD000000000000PRDC009',
  leatherOnePlus12:    '01JVPRD000000000000PRDC010',
}

export default class MainSeeder extends BaseSeeder {
  async run() {
    const ts = now()

    const products = [
      {
        id: SEED_PRODUCT_IDS.siliconeiPhone15,
        name: 'Capinha Silicone Premium iPhone 15',
        description: 'Capinha de silicone macio anti-impacto para iPhone 15',
        category: 'silicone',
        price: 3990,
        image_url: null,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: SEED_PRODUCT_IDS.leatherGalaxyS24,
        name: 'Capa Couro Genuíno Samsung Galaxy S24',
        description: 'Capa em couro legítimo com porta-cartões para Galaxy S24',
        category: 'leather',
        price: 12990,
        image_url: null,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: SEED_PRODUCT_IDS.clearIPhone14,
        name: 'Capinha Crystal Clear iPhone 14',
        description: 'Capinha transparente ultra-fina para iPhone 14',
        category: 'clear',
        price: 2990,
        image_url: null,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: SEED_PRODUCT_IDS.ruggedMotoEdge40,
        name: 'Capa Rugged Militar Motorola Edge 40',
        description: 'Proteção total militar MIL-STD-810G para Motorola Edge 40',
        category: 'rugged',
        price: 8990,
        image_url: null,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: SEED_PRODUCT_IDS.siliconXiaomi13T,
        name: 'Capinha Silicone Xiaomi 13T',
        description: 'Capinha silicone líquido com microfibra para Xiaomi 13T',
        category: 'silicone',
        price: 4490,
        image_url: null,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: SEED_PRODUCT_IDS.leatherPixel8,
        name: 'Capa Couro Vegano Google Pixel 8',
        description: 'Capa em couro vegano sustentável para Google Pixel 8',
        category: 'leather',
        price: 9990,
        image_url: null,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: SEED_PRODUCT_IDS.clearMagsafeiPhone15Pro,
        name: 'Capinha Clear Magsafe iPhone 15 Pro',
        description: 'Capinha transparente compatível com MagSafe para iPhone 15 Pro',
        category: 'clear',
        price: 5990,
        image_url: null,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: SEED_PRODUCT_IDS.ruggedGalaxyA54,
        name: 'Capa Rugged Samsung Galaxy A54',
        description: 'Capa resistente a quedas e poeira para Galaxy A54',
        category: 'rugged',
        price: 6990,
        image_url: null,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: SEED_PRODUCT_IDS.siliconRedmiNote13,
        name: 'Capinha Silicone Redmi Note 13',
        description: 'Capinha silicone colorida com proteção de câmera para Redmi Note 13',
        category: 'silicone',
        price: 2990,
        image_url: null,
        created_at: ts,
        updated_at: ts,
      },
      {
        id: SEED_PRODUCT_IDS.leatherOnePlus12,
        name: 'Capa Couro Carteira OnePlus 12',
        description: 'Capa carteira em couro PU com suporte para OnePlus 12',
        category: 'leather',
        price: 7990,
        image_url: null,
        created_at: ts,
        updated_at: ts,
      },
    ]

    // ON CONFLICT IGNORE — safe to run multiple times
    await db.table('products').insert(products).onConflict('id').ignore()

    const stocks = products.map((product) => ({
      id: ulid(),
      product_id: product.id,
      quantity: 50,
      created_at: ts,
      updated_at: ts,
    }))

    await db.table('stocks').insert(stocks).onConflict('product_id').ignore()
  }
}
