import {
  Provide,
  Init,
  Scope,
  ScopeEnum,
  Inject,
  TaskLocal,
  App,
  MidwayFrameworkType,
  Logger,
} from '@midwayjs/decorator';
import { Application } from '@midwayjs/socketio';
import { Util } from '../util/util';
import { Logs } from './logBase';
import { RedisService } from './redis';
import { Device } from './deviceBase';
import { EventEmitter } from 'events';
import { ILogger } from '@midwayjs/logger';

interface mountDevEx extends Uart.TerminalMountDevs {
  TerminalMac: string;
  Interval: number;
  mountNode: string;
}

@Provide()
@Scope(ScopeEnum.Singleton)
export class SocketUart {
  @Logger()
  logger: ILogger;

  @Inject()
  private Util: Util;

  @Inject()
  private log: Logs;

  @Inject()
  private RedisService: RedisService;

  @Inject()
  private Device: Device;

  @App(MidwayFrameworkType.WS_IO)
  private app: Application;

  /**
   * 节点信息缓存
   */
  nodeMap: Map<string, Uart.NodeClient>;
  /**
   * 查询指令缓存
   */
  cache: Map<string, mountDevEx>;
  /**
   * 迭代计数器
   */
  private count: number;
  /**
   * 协议缓存
   */
  proMap: Map<string, Uart.protocol>;
  /**
   * 指令缓存
   */
  private CacheQueryIntruct: Map<string, string>;
  /**
   * 事件对象
   */
  event: EventEmitter;

  @Init()
  async init() {
    this.nodeMap = new Map();

    this.cache = new Map();

    this.proMap = new Map();

    this.CacheQueryIntruct = new Map();

    this.count = 0;

    this.event = new EventEmitter();

    this.event.setMaxListeners(100);

    // 循环迭代缓存,发送查询指令
    // 设置定时器
    setInterval(() => {

      this.cache.forEach(mountDev => {
        // 判断轮询计算结果是否是正整数,是的话发送查询指令
        if (Number.isInteger(this.count / mountDev.Interval)) {
          this._SendQueryIntruct(mountDev);
        }
      });
      this.count += 500;
    }, 500);

    // 设置所有终端为离线状态
    this.Device.getTerminals({ DevMac: 1, _id: 0 }).then(els => {
      els.forEach(el => {
        this.Device.setStatTerminal(el.DevMac, false);
      });
    });
  }

  /**
   * 缓存协议
   * @param protocol
   */
  private async cacheProtocol(protocol: string) {
    if (!this.proMap.has(protocol)) {
      const pro = (await this.Device.getProtocol(protocol)) as Uart.protocol;
      /**
       * 刷选出正在使用的指令
       */
      pro.instruct = pro.instruct.filter(el => el.isUse);
      this.proMap.set(protocol, pro);
    }
    return this.proMap.get(protocol);
  }

  /**
   * 更新缓存协议
   * @param protocol
   */
  UpdateCacheProtocol(protocol: string) {
    return this.proMap.delete(protocol);
  }

  /**
   * 根据socket.id获取节点信息
   * @param id
   */
  async getNode(id: string) {
    const name = await this.RedisService.getSocketSid(id);
    if (!this.nodeMap.has(name)) {
      const node = await this.Device.getNode(name);
      if (node) this.nodeMap.set(name, node);
    }
    return this.nodeMap.get(name);
  }

  /**
   * 获取socket node命名空间实例
   * @returns
   */
  getApp() {
    return this.app.of('/node');
  }

  /**
   * 获取指定节点socket
   */
  getCtx(name: string) {
    return this.getApp().in(name);
  }

  /**
   * 每分钟获取一次节点状态
   * https://www.yuque.com/midwayjs/midway_v2/task
   */
  @TaskLocal('* * * * *')
  async nodeInfo() {
    const nodes = await this.Device.getNodes();
    nodes.forEach(node => {
      this.getCtx(node.Name).emit('nodeInfo', node.Name);
    });
  }

  /**
   * 每hour清理一处节点信息缓存
   * https://www.yuque.com/midwayjs/midway_v2/task
   */
  @TaskLocal('1 * * * *')
  async clear_nodeMap() {
    this.nodeMap.forEach(node => {
      this.getCtx(node.Name).emit('nodeInfo', node.Name);
    });
    this.nodeMap.clear();
    this.count = 0;
  }

  /**
   *
   * 每天5点重置一次指令缓存
   */
  @TaskLocal('0 5 * * *')
  async clear_Cache() {
    this.logger.info(`${new Date().toLocaleString()}===clear_Cache`);
    const nodes = await this.Device.getNodes();
    this.cache.clear();
    nodes.forEach(node => this.setNodeCache(node.Name));
  }

  /**
   * 根据节点名称缓存终端
   * @param nodeName
   */
  async setNodeCache(nodeName: string) {
    const terminals = (
      await this.Device.getTerminals({
        _id: 0,
        createdAt: 0,
        updatedAt: 0,
        __v: 0,
      })
    ).filter(el => el.mountNode === nodeName);

    terminals.forEach(async ({ DevMac, mountDevs, mountNode }) => {
      //if (mountNode !== 'test' && mountDevs) {
      if (mountDevs) {
        const Interval = await this.Device.getMountDevInterval(DevMac);
        mountDevs.forEach(mountDev => {
          this.cache.set(DevMac + mountDev.pid, {
            ...mountDev,
            TerminalMac: DevMac,
            Interval,
            mountNode,
          });
        });
      }
    });
  }

  /**
   * 根据终端缓存终端
   * @param mac
   * @param interVal 查询间隔
   */
  async setTerminalMountDevCache(mac: string, interVal?: number) {
    const { mountDevs, DevMac, mountNode } = await this.Device.getTerminal(mac);
    if (mountNode !== 'test' && mountDevs) {
      const Interval = interVal || (await this.Device.getMountDevInterval(mac));
      mountDevs.forEach(mountDev => {
        this.cache.set(DevMac + mountDev.pid, {
          ...mountDev,
          TerminalMac: DevMac,
          Interval,
          mountNode,
        });
      });
    }
  }

  /**
   * delete终端缓存终端
   * @param mac
   */
  async delTerminalMountDevCache(mac: string, pid: number) {
    this.cache.delete(mac + pid);
  }

  /**
   * 根据节点名称清除缓存
   * @param nodeName
   */
  async delNodeCache(nodeName: string) {
    this.cache.forEach((val, key) => {
      if (val.mountNode === nodeName) this.cache.delete(key);
    });
  }

  /**
   * 发送查询指令
   * @param Query
   */
  private async _SendQueryIntruct(Query: mountDevEx) {
    const mac = Query.TerminalMac;

    if (
      !(await this.RedisService.hasDtuWorkBus(mac)) &&
      (await this.Device.getStatTerminal(mac))
    ) {
      // 获取设备协议
      const Protocol = await this.cacheProtocol(Query.protocol);
      // 获取协议指令生成缓存
      const CacheQueryIntruct = this.CacheQueryIntruct;
      // 迭代设备协议获取多条查询数据
      const content = Protocol.instruct.map(ProtocolInstruct => {
        // 缓存查询指令
        const IntructName =
          Protocol.Protocol + Query.pid + ProtocolInstruct.name;
        if (CacheQueryIntruct.has(IntructName))
          return CacheQueryIntruct.get(IntructName) as string;
        else {
          let content = '';
          switch (ProtocolInstruct.resultType) {
            case 'utf8':
              if (Protocol.Type === 232) {
                content = ProtocolInstruct.name;
                break;
              }
            /* case "HX":
                            content = tool.HX(Query.pid, ProtocolInstruct.name)
                            break; */
            default:
              // 如果是非标协议,且包含前处理脚本
              if (ProtocolInstruct.noStandard && ProtocolInstruct.scriptStart) {
                // 转换脚本字符串为Fun函数,此处不保证字符串为规定的格式,请在添加协议的时候手工校验
                const Fun = this.Util.ParseFunction(
                  ProtocolInstruct.scriptStart
                );
                content = Fun(Query.pid, ProtocolInstruct.name);
              } else {
                content = this.Util.Crc16modbus(
                  Query.pid,
                  ProtocolInstruct.name
                );
              }
              break;
          }
          CacheQueryIntruct.set(IntructName, content);
          this.RedisService.setContentToInstructName(
            content,
            ProtocolInstruct.name
          );
          return content;
        }
      });
      const query: Uart.queryObject = {
        mac,
        type: Protocol.Type,
        mountDev: Query.mountDev,
        protocol: Query.protocol,
        pid: Query.pid,
        timeStamp: Date.now(),
        content,
        Interval: Query.Interval,
        useTime: 0,
      };
      this.getCtx(Query.mountNode).emit('query', query);
    }
  }

  /**
   * 发送程序变更指令
   * @param Query 指令对象
   */
  public async InstructQuery(Query: Uart.instructQuery) {
    const terminal = await this.Device.getTerminal(Query.DevMac);
    if (terminal) {
      if (
        (await this.app.of('/node').in(terminal.mountNode).fetchSockets())
          .length > 0
      ) {
        // 取出查询间隔
        Query.Interval = 20000;
        // 构建指令
        if (
          (await this.Device.getProtocol(Query.protocol, { Type: 1 })).Type ===
          485
        ) {
          const instructs = (await this.cacheProtocol(Query.protocol)).instruct;
          // 如果包含非标协议,取第一个协议指令的前处理脚本处理指令内容
          if (
            instructs &&
            instructs[0].noStandard &&
            instructs[0].scriptStart
          ) {
            const Fun = this.Util.ParseFunction(instructs[0].scriptStart);
            Query.content = Fun(Query.pid, Query.content);
          } else {
            Query.content = this.Util.Crc16modbus(Query.pid, Query.content);
          }
        }
        return new Promise<Partial<Uart.ApolloMongoResult>>(resolve => {
          // 创建一次性监听，监听来自Node节点指令查询操作结果
          this.event.once(Query.events, result => {
            this.log.saveTerminal({
              NodeIP: '',
              NodeName: terminal.mountNode,
              TerminalMac: Query.DevMac,
              type: '操作设备',
              query: Query,
              result,
            });
            if (result.ok)
              this.Device.setStatTerminalDevs(Query.DevMac, Query.pid);
            resolve(result);
          });
          this.getApp().in(terminal.mountNode).emit('instructQuery', Query);
          // 设置定时器，超过30秒无响应则触发事件，避免事件堆积内存泄漏
          setTimeout(() => {
            resolve({
              ok: 0,
              msg: 'Node节点无响应，请检查设备状态信息是否变更',
            });
          }, Query.Interval * 2);
        });
      } else {
        return { ok: 0, msg: '设备所在节点离线' };
      }
    } else {
      throw new Error('无此设备');
    }
  }

  /**
   * 下发操作指令到DTU
   * @param Query 指令对象
   */
  public async OprateDTU(Query: Uart.DTUoprate) {
    const terminal = await this.Device.getTerminal(Query.DevMac);
    if (terminal) {
      if (
        (await this.app.of('/node').in(terminal.mountNode).fetchSockets())
          .length > 0
      ) {
        // 构建指令
        return new Promise<Partial<Uart.ApolloMongoResult>>(resolve => {
          // 创建一次性监听，监听来自Node节点指令查询操作结果
          this.event.once(Query.events, (result: Uart.ApolloMongoResult) => {
            this.log.saveTerminal({
              NodeIP: '',
              NodeName: terminal.mountNode,
              TerminalMac: Query.DevMac,
              type: 'DTU操作',
              query: Query,
              result,
            });

            resolve(result);
          });
          this.getApp().in(terminal.mountNode).emit('DTUoprate', Query);
          // 设置定时器，超过30秒无响应则触发事件，避免事件堆积内存泄漏
          setTimeout(() => {
            this.event.removeListener(Query.events, () => {
              resolve({
                ok: 0,
                msg: 'Node节点无响应，请检查设备状态信息是否变更',
              });
            });
          }, 10000);
        });
      } else {
        return { ok: 0, msg: '设备所在节点离线' };
      }
    } else {
      throw new Error('无此设备');
    }
  }

  /**
   * 往node节点发送信息
   * @param node 节点名称
   * @param eventName 监听的发送的事件名称
   * @param data 
   * @param timeOut 
   */
  async sendMessagetoNode<T>(node: string, eventName: string, data: any = {}, timeOut: number = 10000) {
    return new Promise<T>((resolve, reject) => {
      /**
       * 监听返回的事件名称
       */
      const resultEventName = eventName + Date.now()
      // 创建一次性监听，监听来自Node节点指令查询操作结果
      this.event.once(resultEventName, (result: T) => {
        resolve(result);
      });
      this.getApp().in(node).emit(eventName, { eventName: resultEventName, data });
      // 设置定时器，超过30秒无响应则触发事件，避免事件堆积内存泄漏
      setTimeout(() => {
        this.event.removeListener(resultEventName, () => {
          reject('Node节点无响应')
        });
      }, timeOut);
    });
  }

  /**
   * 重启节点程序
   * @param node 
   * @returns 
   */
  async nodeRestart(node: string) {
    return this.sendMessagetoNode(node, 'restart')
  }
}
