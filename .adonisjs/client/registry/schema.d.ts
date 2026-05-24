/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'products.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/products'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/product_validator').productQueryValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/products_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/products_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'products.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/products/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/product_validator').productParamsValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/products_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/products_controller').default['show']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'checkout.store': {
    methods: ["POST"]
    pattern: '/api/v1/checkout'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/checkout_validator').checkoutValidator)>|InferInput<(typeof import('#validators/checkout_validator').checkoutHeaderValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/checkout_validator').checkoutValidator)>|InferInput<(typeof import('#validators/checkout_validator').checkoutHeaderValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/checkout_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/checkout_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'orders.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/orders/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/product_validator').orderParamsValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/orders_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/orders_controller').default['show']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
}
