import { Configuration, App } from '@midwayjs/decorator';
import { Application } from '@midwayjs/koa';
import * as body from 'koa-body';
import { ILifeCycle } from '@midwayjs/core';
import * as typegoose from '@midwayjs/typegoose';
import * as task from '@midwayjs/task';
import { join } from 'path';
import * as cors from '@koa/cors';
import * as swagger from '@midwayjs/swagger';
import * as oss from '@midwayjs/oss';

@Configuration({
  conflictCheck: true,
  imports: [typegoose, task, swagger, oss],
  importConfigs: [join(__dirname, './config')],
})
export class ContainerLifeCycle implements ILifeCycle {
  @App()
  app: Application;

  async onReady() {
    this.app.proxy = true;
    this.app
      .use(
        body({
          multipart: true,
          formidable: {
            maxFileSize: 1024 * 1024 * 100 * 100,
          },
        })
      )
      .use(
        cors({
          origin: '*',
        })
      );
  }
}
