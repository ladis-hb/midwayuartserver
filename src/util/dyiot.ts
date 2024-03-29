import { Config } from '@alicloud/openapi-client';
import Dyiotapi, * as $Dyiotapi from '@alicloud/dyiotapi20171111';
import { Provide, Scope, ScopeEnum, Init } from '@midwayjs/decorator';
import { SecretApp } from '../entity/user';
import { getModelForClass } from '@typegoose/typegoose';

/**
 * ali无线物联服务api
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class DyIot {
  iot: Dyiotapi;

  /**
   * 使用AK&SK初始化账号Client
   */
  @Init()
  async init() {
    const key = await getModelForClass(SecretApp)
      .findOne({ type: 'dyIot' })
      .lean();
    const config = new Config({
      accessKeyId: key.appid,
      accessKeySecret: key.secret,
    });
    config.endpoint = 'dyiotapi.aliyuncs.com';
    this.iot = new Dyiotapi(config);
  }

  /**
   * 查询物联网卡的流量信息
   * @param Iccid
   * @returns
   * https://help.aliyun.com/document_detail/141125.htm
   */
  async QueryCardFlowInfo(iccid: string) {
    const req = new $Dyiotapi.QueryCardFlowInfoRequest({
      iccid,
    });
    const res = await this.iot.queryCardFlowInfo(req);
    return res.body;
  }

  /**
   * 解绑复机
   * @param Iccid
   * @returns
   */
  async DoIotUnbindResume(iccid: string) {
    const req = new $Dyiotapi.DoIotUnbindResumeRequest({
      iccid,
    });
    const res = await this.iot.doIotUnbindResume(req);
    return res.body;
  }

  /**
   * 提交物联网卡设备信息
   * @param Imei
   * @param Comments
   * @param DeviceType
   * https://help.aliyun.com/document_detail/141128.htm
   */
  async DoIotPostImei(imei: string, comments: string, deviceType: string) {
    const req = new $Dyiotapi.DoIotPostImeiRequest({
      imei,
      comments,
      deviceType,
    });
    const res = await this.iot.doIotPostImei(req);
    return res.body;
  }

  /**
   * 解绑或换绑物联网卡
   * @param iccid
   * @param imei
   * @param newImei
   * @param opionType
   * @returns
   * https://help.aliyun.com/document_detail/141149.htm
   */
  async DoIotChgBindOrUnBindRequest(
    iccid: string,
    imei: string,
    newImei: string,
    opionType: 'unBind' | 'chgBind'
  ) {
    const doIotChgBindOrUnBindRequest =
      new $Dyiotapi.DoIotChgBindOrUnBindRequest({
        iccid,
        imei,
        newImei,
        opionType,
      });
    // 复制代码运行请自行打印 API 的返回值
    const res = await this.iot.doIotChgBindOrUnBind(
      doIotChgBindOrUnBindRequest
    );
    return res.body;
  }

  /**
   * 查询物联网卡的明细信息
   * @param iccid
   * @returns
   * https://help.aliyun.com/document_detail/141150.htm
   */
  async QueryCardInfo(iccid: string) {
    const queryCardInfoRequest = new $Dyiotapi.QueryCardInfoRequest({
      iccid,
    });
    // 复制代码运行请自行打印 API 的返回值
    const res = await this.iot.queryCardInfo(queryCardInfoRequest);
    return res.body;
  }

  /**
   * 查询物联网卡当前时间有效套餐的列表
   * @param iccid
   * https://help.aliyun.com/document_detail/141127.html
   */
  async QueryIotCardOfferDtl(iccid: string) {
    const queryIotCardOfferDtlRequest =
      new $Dyiotapi.QueryIotCardOfferDtlRequest({
        iccid,
      });
    // 复制代码运行请自行打印 API 的返回值
    const res = await this.iot.queryIotCardOfferDtl(
      queryIotCardOfferDtlRequest
    );
    return res.body;
  }

  /**
   * 续订套餐
   * @param iccid 要充值的物联卡对应的Iccid编码
   * @param offerIds 充值的套餐编号
   * @param outId 外部流水编码
   * @param effCode 套餐生效类型。取值：AUTO_ORD：自动在当前套餐失效后，续订本次套餐。若有多个未生效套餐，则本次续订是从最后一个未生效套餐开始往后续。1000：立即生效
   * @returns
   * https://help.aliyun.com/document_detail/141151.htm
   */
  async DoIotRecharge(
    iccid: string,
    offerIds: string = Date.now().toString(),
    outId: string = Date.now().toString(),
    effCode: '1000' | 'AUTO_ORD' = '1000'
  ) {
    const doIotRechargeRequest = new $Dyiotapi.DoIotRechargeRequest({
      iccid,
      offerIds,
      outId,
      effCode,
    });
    // 复制代码运行请自行打印 API 的返回值
    const res = await this.iot.doIotRecharge(doIotRechargeRequest);
    return res.body;
  }

  /**
   * 格式化物联网api返回的时间
   * @param date
   */
  parseIotDate(date: string) {
    const str = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(
      6,
      8
    )} ${date.slice(8, 10)}:${date.slice(10, 12)}`;
    return new Date(str).getTime();
  }
}
