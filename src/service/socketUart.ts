import { Provide, Init, Scope, ScopeEnum, Inject, TaskLocal, App, MidwayFrameworkType } from "@midwayjs/decorator"
import { Application } from "@midwayjs/socketio"
import { Util } from "../util/util"
import { Logs } from "./log"
import { RedisService } from "./redis"
import { Device } from "./device"

interface mountDevEx extends Uart.TerminalMountDevs {
    TerminalMac: string
    Interval: number
    mountNode: string
}

@Provide()
@Scope(ScopeEnum.Singleton)
export class SocketUart {

    @Inject()
    private Util: Util

    @Inject()
    private log: Logs

    @Inject()
    private RedisService: RedisService


    @Inject()
    private Device: Device

    @App(MidwayFrameworkType.WS_IO)
    private app: Application


    /**
     * 节点信息缓存
     */
    nodeMap: Map<string, Uart.NodeClient>
    cache: Map<string, mountDevEx>
    private count: number
    proMap: Map<string, Uart.protocol>
    CacheQueryIntruct: Map<string, string>

    @Init()
    async init() {
        this.nodeMap = new Map()

        this.cache = new Map()

        this.proMap = new Map()

        this.CacheQueryIntruct = new Map()

        this.count = 0


        // 循环迭代缓存,发送查询指令
        // 设置定时器
        setInterval(() => {
            this.cache.forEach((mountDev) => {
                // 判断轮询计算结果是否是正整数,是的话发送查询指令
                if (Number.isInteger(this.count / mountDev.Interval)) {
                    this._SendQueryIntruct(mountDev)
                }
            })
            this.count += 500
        }, 500)
    }

    /**
     * 缓存协议
     * @param protocol 
     */
    private async cacheProtocol(protocol: string) {
        if (!this.proMap.has(protocol)) {
            this.proMap.set(protocol, await this.Device.getProtocol(protocol) as any)
        }
        return this.proMap.get(protocol)
    }


    /**
     * 根据socket.id获取节点信息
     * @param id 
     */
    async getNode(id: string) {
        const name = await this.RedisService.getClient().get("sid" + id)
        if (!this.nodeMap.has(name)) {
            const node = await this.Device.getNode(name)
            if (node) this.nodeMap.set(name, node)
        }
        return this.nodeMap.get(name)
    }

    /**
     * 获取socket node命名空间实例
     * @returns 
     */
    getApp() {
        return this.app.of('/node')
    }

    /**
     * 获取指定节点socket
     */
    getCtx(name: string) {
        return this.getApp().in(name)
    }

    /**
     * 每分钟清理一处节点信息缓存
     */
    @TaskLocal("1 * * * *")
    async clear_nodeMap() {
        this.nodeMap.clear()
        this.count = 0
    }

    /**
     * 根据节点名称缓存终端
     * @param nodeName 
     */
    async setNodeCache(nodeName: string) {
        const terminals = (await this.Device.getTerminals({ _id: 0, createdAt: 0, updatedAt: 0, __v: 0 })).filter(el => el.mountNode === nodeName)
        terminals.forEach(async ({ DevMac, mountDevs, mountNode }) => {
            this.Device.setStatTerminal(DevMac)
            if (mountDevs) {
                const Interval = await this.Device.getMountDevInterval(DevMac)
                mountDevs.forEach(mountDev => {
                    this.cache.set(DevMac + mountDev.pid, { ...mountDev, TerminalMac: DevMac, Interval, mountNode })
                })
            }
        })
    }

    /**
     * 根据节点名称清除缓存
     * @param nodeName 
     */
    async delNodeCache(nodeName: string) {
        this.cache.forEach((val, key) => {
            if (val.mountNode === nodeName) this.cache.delete(key)
        })
    }

    /**
     * 发送查询指令
     * @param Query 
     */
    private async _SendQueryIntruct(Query: mountDevEx) {
        const mac = Query.TerminalMac
        // 判断挂载设备是否空闲和是否在线
        /* console.log({
            mac,
            a:await this.RedisService.hasDtuWorkBus(mac),
            b:await this.Device.getStatTerminal(mac)
        });
         */
        if (!await this.RedisService.hasDtuWorkBus(mac) && await this.Device.getStatTerminal(mac)) {
            // console.log("send" + mac, Query.Interval, this.Event.getClientDtuMountDev(Query.TerminalMac, Query.pid));
            // 获取设备协议
            const Protocol = await this.cacheProtocol(Query.protocol)
            // 获取协议指令生成缓存
            const CacheQueryIntruct = this.CacheQueryIntruct
            // 迭代设备协议获取多条查询数据
            const content = Protocol.instruct.map(ProtocolInstruct => {
                // 缓存查询指令
                const IntructName = Protocol.Protocol + Query.pid + ProtocolInstruct.name
                if (CacheQueryIntruct.has(IntructName)) return CacheQueryIntruct.get(IntructName) as string
                else {
                    let content = ""
                    switch (ProtocolInstruct.resultType) {
                        case "utf8":
                            content = ProtocolInstruct.name
                            break
                        /* case "HX":
                            content = tool.HX(Query.pid, ProtocolInstruct.name)
                            break; */
                        default:
                            // 如果是非标协议,且包含前处理脚本
                            if (ProtocolInstruct.noStandard && ProtocolInstruct.scriptStart) {
                                // 转换脚本字符串为Fun函数,此处不保证字符串为规定的格式,请在添加协议的时候手工校验
                                const Fun = this.Util.ParseFunction(ProtocolInstruct.scriptStart)
                                content = Fun(Query.pid, ProtocolInstruct.name)
                            } else {
                                content = this.Util.Crc16modbus(Query.pid, ProtocolInstruct.name)
                            }
                            break;
                    }
                    CacheQueryIntruct.set(IntructName, content)
                    this.RedisService.setContentToInstructName(content, ProtocolInstruct.name)
                    return content
                }
            })
            const query: Uart.queryObject = {
                mac,
                type: Protocol.Type,
                mountDev: Query.mountDev,
                protocol: Query.protocol,
                pid: Query.pid,
                timeStamp: Date.now(),
                content,
                Interval: Query.Interval,
                useTime: 0
            }
            this.getCtx(Query.mountNode).emit('query', query)
        }
    }

    /**
     * 发送程序变更指令
     * @param Query 指令对象
     */
    public async InstructQuery(Query: Uart.instructQuery) {
        const terminal = await this.Device.getTerminal(Query.DevMac)
        if (terminal) {
            if ((await this.app.of("/node").in(terminal.mountNode).fetchSockets()).length > 0) {
                // 取出查询间隔
                Query.Interval = 20000
                // 构建指令
                if (Query.type === 485) {
                    const instructs = (await this.cacheProtocol(Query.protocol)).instruct
                    // 如果包含非标协议,取第一个协议指令的前处理脚本处理指令内容
                    if (instructs && instructs[0].noStandard && instructs[0].scriptStart) {
                        const Fun = this.Util.ParseFunction(instructs[0].scriptStart)
                        Query.content = Fun(Query.pid, Query.content)
                    } else {
                        Query.content = this.Util.Crc16modbus(Query.pid, Query.content)
                    }
                    return new Promise<Partial<Uart.ApolloMongoResult>>((resolve) => {
                        // 创建一次性监听，监听来自Node节点指令查询操作结果            
                        this
                            .getApp()
                            .once(Query.events, result => {
                                this.log.saveTerminal({ NodeIP: '', NodeName: terminal.mountNode, TerminalMac: Query.DevMac, type: "操作设备", query: Query, result })
                                resolve(result)
                            })
                            .in(terminal.mountNode)
                            .emit('instructQuery', Query)
                        // 设置定时器，超过30秒无响应则触发事件，避免事件堆积内存泄漏
                        setTimeout(() => {
                            resolve({ ok: 0, msg: 'Node节点无响应，请检查设备状态信息是否变更' })
                        }, Query.Interval * 2);
                    })
                }
            } else {
                return { ok: 0, msg: '设备所在节点离线' }
            }
        } else {
            throw new Error('无此设备')
        }
    }

    /**
     * 下发操作指令到DTU
     * @param Query 指令对象
     */
    public async OprateDTU(Query: Uart.DTUoprate) {
        const terminal = await this.Device.getTerminal(Query.DevMac)
        if (terminal) {
            if ((await this.app.of("/node").in(terminal.mountNode).fetchSockets()).length > 0) {
                // 构建指令
                return new Promise<Partial<Uart.ApolloMongoResult>>((resolve) => {
                    // 创建一次性监听，监听来自Node节点指令查询操作结果            
                    this
                        .getApp()
                        .once(Query.events, result => {
                            this.log.saveTerminal({ NodeIP: '', NodeName: terminal.mountNode, TerminalMac: Query.DevMac, type: "DTU操作", query: Query, result })
                            resolve(result)
                        })
                        .in(terminal.mountNode)
                        .emit('DTUoprate', Query)
                    // 设置定时器，超过30秒无响应则触发事件，避免事件堆积内存泄漏
                    setTimeout(() => {
                        resolve({ ok: 0, msg: 'Node节点无响应，请检查设备状态信息是否变更' })
                    }, 30000 * 2);
                })
            } else {
                return { ok: 0, msg: '设备所在节点离线' }
            }
        } else {
            throw new Error('无此设备')
        }
        /* return new Promise<Partial<Uart.ApolloMongoResult>>((resolve) => {
            // 在在线设备中查找
            const terminal = this.Event.Cache.CacheTerminal.get(Query.DevMac)
            if (terminal) {
                const client = this.CacheSocket.get(terminal.mountNode)
                if (client && client.socket.connected) {
                    // 创建一次性监听，监听来自Node节点指令查询操作结果            
                    client.socket.once(Query.events, result => {
                        this.Event.savelog<Uart.logTerminals>('terminal', { NodeIP: client.property.IP, NodeName: client.property.Name, TerminalMac: Query.DevMac, type: "DTU操作", query: Query, result })
                        resolve(result)
                    }).emit('DTUoprate', Query)
                    // 设置定时器，超过20秒无响应则触发事件，避免事件堆积内存泄漏
                    setTimeout(() => {
                        resolve({ ok: 0, msg: 'Node节点无响应，请检查设备状态信息是否变更' })
                    }, 60000);
                } else {
                    resolve({ ok: 0, msg: '设备所在节点离线' })
                }
            } else {
                throw new Error('无此设备')
            }
        }) */
    }
}