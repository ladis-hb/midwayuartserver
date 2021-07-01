import { REQUEST_OBJ_CTX_KEY } from '@midwayjs/core';
import { Context } from "@midwayjs/koa"
import { RedisService } from "../service/redis"

export function Sms(): MethodDecorator {
    return (
        target: object,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) => {
        const method = descriptor.value;
        descriptor.value = async function (...args) {
            // 指向当前上层框架的上下文对象，上层框架的上下文对象请参考各上层框架文档。
            const ctx: Context = this[REQUEST_OBJ_CTX_KEY]
            // 获取redis实例
            const Cache = await ctx.requestContext.getAsync(RedisService)
            // 获取token
            const sms = await Cache.getClient().get(ctx.cookies.get("auth._token.local"))
            // 
            if (!['test2', 'root'].includes(ctx.request.body.token.user) && (!sms || sms !== 'true')) {
                ctx.body = {
                    code: 201,
                    data: ctx.request.body,
                    method: ctx.request.url
                }
                return
            } else
                return method.apply(this, [...args]);
        }
        return descriptor;
    };
}
