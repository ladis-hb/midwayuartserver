import { Provide, Init, Inject } from '@midwayjs/decorator';
import { getModelForClass, ReturnModelType, } from "@midwayjs/typegoose"
import { BeAnObject } from '@typegoose/typegoose/lib/types';
import { Users, UserBindDevice, UserAggregation, SecretApp, UserAlarmSetup, UserLayout } from "../entity/user"
import { UartTerminalDataTransfinite, UserLogin } from "../entity/log"
import { Device } from "./device"
import { Sms } from "../util/sms"
import { Wx } from "../util/wx"
import { Util } from "../util/util"
import { filter, MongoTypesId } from '../interface';
import { Terminal, TerminalClientResult, TerminalClientResultSingle } from '../entity/node';
import * as lodash from "lodash"


@Provide()
export class UserService {
  private userModel: ReturnModelType<typeof Users, BeAnObject>
  private loguserModel: ReturnModelType<typeof UserLogin, BeAnObject>;
  private userbindModel: ReturnModelType<typeof UserBindDevice, BeAnObject>;
  private useraggregModel: ReturnModelType<typeof UserAggregation, BeAnObject>;
  private userAlarmSetupModel: ReturnModelType<typeof UserAlarmSetup, BeAnObject>;
  private AlarmModel: ReturnModelType<typeof UartTerminalDataTransfinite, BeAnObject>;
  private layoutModel: ReturnModelType<typeof UserLayout, BeAnObject>;

  @Init()
  async init() {
    this.userModel = getModelForClass(Users)
    this.loguserModel = getModelForClass(UserLogin)
    this.userbindModel = getModelForClass(UserBindDevice)
    this.useraggregModel = getModelForClass(UserAggregation)
    this.userAlarmSetupModel = getModelForClass(UserAlarmSetup)
    this.AlarmModel = getModelForClass(UartTerminalDataTransfinite)
    this.layoutModel = getModelForClass(UserLayout)
  }

  @Inject()
  Device: Device

  @Inject()
  Sms: Sms

  @Inject()
  Wx: Wx

  @Inject()
  Util: Util

  /**
   * 检查是否是用户绑定mac
   * @param user 
   * @param mac 
   * @returns 
   */
  async isBindMac(user: string, mac: string) {
    const r = await this.userbindModel.findOne({ user, UTs: mac }, { _id: 1 })
    return r ? true : false
  }


  /**
   * 发送验证码到用户
   * @param user 
   */
  async sendValidation(user: string) {
    const users = await this.getUser(user, { tel: 1, mail: 1, wxId: 1 })
    if (users.tel) {
      const r = await this.Sms.SendValidation(users.tel)
      return {
        code: r.data.Code === 'OK' ? 200 : 0,
        data: r.code,
        msg: `手机号:${users.tel.slice(0, 3)}***${users.tel.slice(7)}`
      }
    } else if (users.mail) {

    } else if (users.wxId) {

    } else {
      return {
        code: 0,
        msg: 'user is undefine '
      }
    }
  }

  /**
   * 获取所有用户信息
   * @returns 
   */
  getUsers() {
    return this.userModel.find().lean()
  }

  /**
   * 使用用户名或邮箱获取用户信息
   * @param user 
   * @param filter 刷选
   * @returns 
   */
  getUser(user: string, filter: filter<Uart.UserInfo> = { _id: 0 }) {
    return this.userModel.findOne({ $or: [{ user }, { mail: user }, { userId: user }] }, filter).lean()
  }

  /**
   * 创建用户
   * @param user 
   * @returns 
   */
  async createUser(user: Partial<Uart.UserInfo>) {
    const u = await this.userModel.create(user as any)
    await this.userAlarmSetupModel.create({ user: u.user, tels: (u?.tel) ? [u.tel] : [], mails: (u?.mail) ? [u.mail] : [], ProtocolSetup: [] })
    await this.loguserModel.create({ user: u.user, type: '用户注册', address: user.address, msg: '' })
    return u
  }

  /**
   * 更新用户登录记录
   * @param address
   */
  async updateUserLoginlog(user: string, address: string, msg: string = '') {
    return {
      user: await this.userModel.update({ user }, { $set: { modifyTime: new Date(), address } }).lean(),
      log: await this.loguserModel.create({ user, type: '用户登录', address, msg })
    }
  }

  /**
   * 获取用户绑定
   * @param user 
   * @returns 
   */
  private getUserBind(user: string) {
    return this.userbindModel.findOne({ user }, { UTs: 1 }).lean()
  }


  /**
   * 获取用户绑定设备
   * @param user 
   */
  async getUserBindDevices(user: string) {
    const bind = await this.getUserBind(user)
    return {
      UTs: await this.Device.getTerminal(bind.UTs || []),
      ECs: [],
      AGG: await this.useraggregModel.find({ user }).lean()
    }
  }

  /**
   * 获取第三方密匙信息
   * @param type 
   * @returns 
   */
  async getUserSecret(type: 'aliSms' | "mail" | "hf" | 'wxopen' | "wxmp" | 'wxmpValidaton' | 'wxwp') {
    const model = getModelForClass(SecretApp)
    return await model.findOne({ type }).lean()
  }

  /**
   * 获取用户告警
   * @param user 
   * @param start 
   * @param end 
   * @returns 
   */
  async getUserAlarm(user: string, start: number, end: number, filter: filter<Uart.uartAlarmObject> = { _id: 0 }) {
    const bind = await this.getUserBind(user)
    return this.AlarmModel.find({ mac: { $in: bind.UTs || [] }, timeStamp: { $gte: start, $lte: end } }, filter).lean()
  }

  /**
   * 确认用户告警信息
   * @param user 
   * @param id 
   * @returns 
   */
  async confrimAlarm(user: string, id?: MongoTypesId) {
    const bind = await this.getUserBind(user)
    if (id) {
      return await this.AlarmModel.updateOne({ _id: id, mac: { $in: bind.UTs } }, { $set: { isOk: true } }).lean()
    } else {
      return await this.AlarmModel.updateMany({ mac: { $in: bind.UTs } }, { $set: { isOk: true } }).lean()
    }
  }

  /**
   * 修改用户设备别名
   * @param user 
   * @param mac 
   * @param name 
   * @returns 
   */
  async modifyTerminal(user: string, mac: string, name: string) {
    const bind = await this.getUserBind(user)
    console.log(bind.UTs, mac);

    if (bind.UTs.includes(mac)) {
      const model = getModelForClass(Terminal)
      return await model.updateOne({ DevMac: mac }, { $set: { name } }).lean()
    } else throw new Error('mac Error')
  }

  /**
   * 添加绑定设备
   * @param user 
   * @param mac 
   */
  async addUserTerminal(user: string, mac: string) {
    // 检查mac是否已经被绑定
    const isBind = await this.userbindModel.findOne({ UTs: mac })
    if (isBind) {
      return null
    } else {
      return await this.userbindModel.updateOne({ user }, { $addToSet: { UTs: mac } }).lean()
    }
  }

  /**
   * 删除绑定设备
   * @param user 
   * @param mac 
   * @returns 
   */
  async delUserTerminal(user: string, mac: string) {
    return await this.userbindModel.updateOne({ user }, { $pull: { UTs: mac } }).lean()
  }

  /**
   * 删除终端挂载设备
   * @param mac 
   * @param pid 
   */
  async delTerminalMountDev(user: string, mac: string, pid: number) {
    const isBind = await this.isBindMac(user, mac)
    if (!isBind) {
      return null
    } else {
      const model = getModelForClass(Terminal)
      return await model.updateOne({ DevMac: mac }, { $pull: { mountDevs: { pid } } }).lean()
    }
  }

  /**
   *   添加用户终端挂载设备
   * @param user 
   * @param mac 
   * @param param2 
   * @returns 
   */
  async addTerminalMountDev(user: string, mac: string, { Type, mountDev, protocol, pid }: Uart.TerminalMountDevs) {
    const isBind = await this.isBindMac(user, mac)
    if (!isBind) {
      return null
    } else {
      const model = getModelForClass(Terminal)
      return await model.updateOne({ DevMac: mac }, {
        $addToSet: {
          mountDevs: {
            Type,
            mountDev,
            protocol,
            pid
          }
        }
      }).lean()
    }
  }

  /**
   * 获取用户告警配置
   * @param user 
   * @param filter 
   * @returns 
   */
  async getUserAlarmSetup(user: string, filter: filter<Uart.userSetup> = { _id: 0 }) {
    return await this.userAlarmSetupModel.findOne({ user }, filter).lean()
  }

  /**
   * 修改用户告警配置联系方式
   * @param user 
   * @param tels 联系电话
   * @param mails 联系邮箱
   * @returns 
   */
  async modifyUserAlarmSetupTel(user: string, tels: string[], mails: string[]) {
    return await this.userAlarmSetupModel.updateOne({ user }, { $set: { tels, mails } }).lean()
  }

  /**
   * 修改用户信息
   * @param user 
   * @param data 
   * @returns 
   */
  async modifyUserInfo(user: string, data: Partial<Uart.UserInfo>) {
    return await this.userModel.updateOne({ user }, { $set: { ...data as any } }).lean()
  }

  /**
   * 获取公众号二维码
   * @param user 
   * @returns 
   */
  mpTicket(user: string) {
    return this.Wx.MP?.getTicket(user)
  }

  /**
   * 获取小程序二维码
   * @param user 
   * @returns 
   */
  wpTicket(user: string) {
    return this.Wx.WP?.getTicket(user)
  }

  /**
   * 获取用户单个协议告警配置
   * @param user 
   * @param protocol 
   */
  async getUserAlarmProtocol(user: string, protocol: string) {
    const data = await this.userAlarmSetupModel.findOne({ user, "ProtocolSetup.Protocol": protocol }, { "ProtocolSetup.$": 1 }).lean()
    const setup = data.ProtocolSetup[0] as any as Uart.ProtocolConstantThreshold | null
    const obj: Pick<Uart.ProtocolConstantThreshold, "Protocol" | "AlarmStat" | "ShowTag" | "Threshold"> = {
      Protocol: protocol,
      ShowTag: setup?.ShowTag || [],
      Threshold: setup?.Threshold || [],
      AlarmStat: setup?.AlarmStat || []
    }
    return obj
  }

  /**
   * 获取用户设备运行数据
   * @param user 
   * @param mac 
   * @param pid 
   */
  async getTerminalData(user: string, mac: string, pid: number, filter: filter<Uart.queryResultSave> = { _id: 0 }) {
    const isBind = await this.isBindMac(user, mac)
    if (!isBind) {
      return null
    } else {
      const model = getModelForClass(TerminalClientResultSingle)
      return await model.findOne({ mac, pid }, filter).lean()
    }
  }

  /**
   * 获取用户设备运行数据
   * @param user 
   * @param mac 
   * @param pid 
   */
  async getTerminalDataName(user: string, mac: string, pid: number, name: string) {
    const isBind = await this.isBindMac(user, mac)
    if (!isBind) {
      return null
    } else {
      const model = getModelForClass(TerminalClientResultSingle)
      const r = await model.findOne({ mac, pid, "result.name": name }, { "result.$": 1, _id: 0 }).lean()
      return r?.result || []
    }
  }

  /**
   * 获取用户设备运行数据
   * @param user 
   * @param mac 
   * @param pid 
   */
  async getTerminalDatas(user: string, mac: string, pid: number, name: string, start: number, end: number) {
    const isBind = await this.isBindMac(user, mac)
    if (!isBind) {
      return null
    } else {
      const model = getModelForClass(TerminalClientResult)
      return await model.find({ mac, pid, "result.name": name, timeStamp: { $gte: start, $lte: end } }, { "result.$": 1, timeStamp: 1, _id: 0 }).lean()
    }
  }

  /**
   * 重置设备超时状态
   * @param mac 
   * @param pid 
   */
  async refreshDevTimeOut(mac: string, pid: number) {

  }

  /**
   * 固定发送设备操作指令
   * @param query 
   * @param item 
   * @returns 
   */
  async SendProcotolInstructSet(user: string, query: Uart.instructQueryArg, item: Uart.OprateInstruct) {
    if (await this.isBindMac(user, query.DevMac)) {
      const protocol = await this.Device.getProtocol(query.protocol)
      // 携带事件名称，触发指令查询
      const Query: Uart.instructQuery = {
        protocol: query.protocol,
        DevMac: query.DevMac,
        pid: query.pid,
        type: protocol.Type,
        events: 'oprate' + Date.now() + query.DevMac,
        content: item.value
      }
      // 检查操作指令是否含有自定义参数
      if (/(%i)/.test(item.value)) {
        // 如果识别字为%i%i,则把值转换为四个字节的hex字符串,否则转换为两个字节
        if (/%i%i/.test(item.value)) {
          const b = Buffer.allocUnsafe(2)
          b.writeIntBE(this.Util.ParseCoefficient(item.bl, Number(item.val)), 0, 2)
          Query.content = item.value.replace(/(%i%i)/, b.slice(0, 2).toString("hex"))
        } else {
          const val = this.Util.ParseCoefficient(item.bl, Number(item.val)).toString(16)
          Query.content = item.value.replace(/(%i)/, val.length < 2 ? val.padStart(2, '0') : val)
        }
      }
      //const result = await ctx.$Event.DTU_OprateInstruct(Query)
      //return result
      return true
    } else {
      return null
    }
  }

  /**
   * 设置用户自定义设置(协议配置)
   * @param user 
   * @param Protocol 协议
   * @param type 操作类型
   * @param arg 参数
   * @returns 
   */
  async setUserSetupProtocol(user: string, Protocol: string, type: Uart.ConstantThresholdType, arg: any) {
    // 获取用户告警配置
    const setup = await this.getUserAlarmSetup(user, { user: 1, tels: 1, mails: 1, ProtocolSetup: 1 }) //await UserAlarmSetup.findOne({ user: ctx.user }).lean<Pick<Uart.userSetup, 'user' | 'mails' | 'tels' | 'ProtocolSetup'>>()!
    // 如果没有初始配置则新建
    if (!setup) {
      await this.userAlarmSetupModel.create({ user, tels: [], mails: [], ProtocolSetup: [] })
    }
    // 如果如果没有ProtocolSetup属性或ProtocolSetup中没有此协议则加入
    if (setup?.ProtocolSetup || setup.ProtocolSetup.findIndex(el => el.Protocol === Protocol) === -1) {
      await this.userAlarmSetupModel.updateOne({ user }, { $push: { ProtocolSetup: { Protocol } as any } }, { upsert: true }).exec()
    }
    let result;
    switch (type) {
      case "Threshold":
        {
          const { type, data }: { type: 'del' | 'add', data: Uart.Threshold } = arg
          if (type === 'del') {
            result = await this.userAlarmSetupModel.updateOne({ user, "ProtocolSetup.Protocol": Protocol }, { $pull: { "ProtocolSetup.$.Threshold": { name: data.name } } })
          } else {
            const has = await this.userAlarmSetupModel.findOne({ user, ProtocolSetup: { $elemMatch: { "Protocol": Protocol, "Threshold.name": data.name } } })
            if (has) {
              // https://www.cnblogs.com/zhongchengyi/p/12162792.html
              result = await this.userAlarmSetupModel.updateOne(
                { user },
                { $set: { "ProtocolSetup.$[i1].Threshold.$[i2]": data } },
                {
                  arrayFilters: [
                    { "i1.Protocol": Protocol },
                    { "i2.name": data.name }
                  ]
                }
              )
            } else {
              result = await this.userAlarmSetupModel.updateOne(
                { user, "ProtocolSetup.Protocol": Protocol },
                { $push: { "ProtocolSetup.$.Threshold": data } },
                { upsert: true }
              )
            }

          }
        }
        break
      case "ShowTag":
        {
          result = await this.userAlarmSetupModel.updateOne(
            { user, "ProtocolSetup.Protocol": Protocol },
            { $set: { "ProtocolSetup.$.ShowTag": lodash.compact(arg as string[]) } },
            { upsert: true }
          )
        }
        break
      case "AlarmStat":
        {
          const { name, alarmStat } = arg
          // 检查系统中是否含有name的配置
          const has = await this.userAlarmSetupModel.findOne({ user, ProtocolSetup: { $elemMatch: { "Protocol": Protocol, "AlarmStat.name": name } } })
          if (has) {
            // https://www.cnblogs.com/zhongchengyi/p/12162792.html
            result = await this.userAlarmSetupModel.updateOne(
              { user },
              { $set: { "ProtocolSetup.$[i1].AlarmStat.$[i2].alarmStat": alarmStat } },
              {
                arrayFilters: [
                  { "i1.Protocol": Protocol },
                  { "i2.name": name }
                ]
              }
            )
          } else {
            result = await this.userAlarmSetupModel.updateOne(
              { user, "ProtocolSetup.Protocol": Protocol },
              { $push: { "ProtocolSetup.$.AlarmStat": { name, alarmStat } } },
              { upsert: true }
            )
          }
        }
        break
    }
    return result;
  }

  /**
   * 获取终端信息
   * @param user 
   * @param mac 
   * @returns 
   */
  async getTerminal(user: string, mac: string) {
    if (await this.isBindMac(user, mac)) {
      return await this.Device.getTerminal(mac)
    } else {
      return null
    }
  }

  Aggregation

  /**
   *  获取用户布局配置
   * @param user 
   * @param id 
   */
  async getUserLayout(user: string, id: string) {
    return await this.layoutModel.findOne({ user, id }).lean()
  }

  /**
   *  获取用户布聚合设备
   * @param user 
   * @param id 
   */
  async getAggregation(user: string, id: string) {
    return await this.useraggregModel.findOne({ user, id }).lean()
  }

  /**
   * 设置用户布局配置
   * @param id 
   * @param type 
   * @param bg 
   * @param Layout 
   */
 async setUserLayout(user:string,id: string, type: string, bg: string, Layout: Uart.AggregationLayoutNode[]){
    return await this.layoutModel.updateOne({ id, user }, { $set: { type, bg, Layout} }, { upsert: true }).lean()
  }

}
