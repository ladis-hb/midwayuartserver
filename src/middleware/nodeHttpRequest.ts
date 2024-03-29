import { Provide } from '@midwayjs/decorator';
import { Context, IMidwayKoaNext, IWebMiddleware } from '@midwayjs/koa';
import { Device } from '../service/deviceBase';

/**
 * 校验数据来源
 */
@Provide()
export class nodeHttp implements IWebMiddleware {
  resolve() {
    return async (ctx: Context, next: IMidwayKoaNext) => {
      const nodes = await (
        await ctx.requestContext.getAsync(Device)
      ).getNodes();

      const ip = ctx.ip.split(':').reverse()[0];
      try {
        if (nodes.some(el => el.IP === ip)) {
          await next();
        } else {
          const err = new Error('nodeData premiss');
          ctx.logger.warn(err);
          throw err;
        }
      } catch (error) {
        ctx.throw('nodeData premiss');
      }
    };
  }
}
