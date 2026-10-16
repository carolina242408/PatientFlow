import { beforeEach, describe, expect, it, vi } from 'vitest';

import axios from 'axios';

import administration, { getGatewayRoutes } from './administration.reducer';

describe('Administration reducer tests', () => {
  function isEmpty(element): boolean {
    if (Array.isArray(element)) {
      return element.length === 0;
    }
    return Object.keys(element).length === 0;
  }

  function testInitialState(state) {
    expect(state).toMatchObject({
      loading: false,
      errorMessage: null,
      totalItems: 0,
    });
    expect(isEmpty(state.gateway.routes)).toBe(true);
  }

  function testMultipleTypes(types, payload, testFunction, error?) {
    types.forEach(e => {
      testFunction(administration(undefined, { type: e, payload, error }));
    });
  }

  describe('Common', () => {
    it('should return the initial state', () => {
      testInitialState(administration(undefined, { type: '' }));
    });
  });

  describe('Requests', () => {
    it('should set state to loading', () => {
      testMultipleTypes([getGatewayRoutes.pending.type], {}, state => {
        expect(state).toMatchObject({
          errorMessage: null,
          loading: true,
        });
      });
    });
  });

  describe('Failures', () => {
    it('should set state to failed and put an error message in errorMessage', () => {
      testMultipleTypes(
        [getGatewayRoutes.rejected.type],
        'something happened',
        state => {
          expect(state).toMatchObject({
            loading: false,
            errorMessage: 'error',
          });
        },
        {
          message: 'error',
        },
      );
    });
  });

  describe('Success', () => {
    it('should update state according to a successful fetch gateway routes request', () => {
      const payload = { data: [] };
      const toTest = administration(undefined, { type: getGatewayRoutes.fulfilled.type, payload });

      expect(toTest).toMatchObject({
        loading: false,
        gateway: { routes: payload.data },
      });
    });
  });
  describe('Actions', () => {
    const resolvedObject = { value: 'whatever' };
    const getState = vi.fn();
    const dispatch = vi.fn();
    const extra = {};
    beforeEach(() => {
      axios.get = vi.fn().mockResolvedValue(resolvedObject);
      axios.post = vi.fn().mockResolvedValue(resolvedObject);
    });
    it('dispatches FETCH_GATEWAY_ROUTE_PENDING and FETCH_GATEWAY_ROUTE_FULFILLED actions', async () => {
      const result = await getGatewayRoutes()(dispatch, getState, extra);

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: getGatewayRoutes.pending.type,
          meta: expect.objectContaining({ requestStatus: 'pending' }),
        }),
      );
      expect(getGatewayRoutes.fulfilled.match(result)).toBe(true);
      expect(result.payload).toBe(resolvedObject);
    });
  });
});
