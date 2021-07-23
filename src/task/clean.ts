import { Provide, Inject, TaskLocal } from "@midwayjs/decorator"
import { Logs } from "../service/log"
import { Device } from "../service/device"
import { DtuBusy, UartTerminalDataTransfinite, UserRequst } from "../entity/log"
import { TerminalClientResults, TerminalClientResult } from "../entity/node"
import { QueryCursor, Types } from "mongoose";
import { DocumentType } from "@typegoose/typegoose"
import { chunk } from "lodash"

/**
 * 每天清理历史记录中重复的数据
 */
@Provide()
export class Clean {

    @Inject()
    logs: Logs


    @Inject()
    Device: Device

    @TaskLocal("0 3 * * * ")
    async clean() {
        console.log(`${new Date().toString()} ### start clean Data.....`);
        const count = {
            NumUserRequst: await this.CleanUserRequst(),
            NumUartterminaldatatransfinites: await this.Uartterminaldatatransfinites(),
            NumClientresults: await this.CleanClientresults(),
            CleanClientresultsTimeOut: await this.CleanClientresultsTimeOut(),
        }
        console.log(`${new Date().toString()} ### end clean Data.....`, count);
        this.logs.saveClean(count)
    }


    /**
 * 清洗告警数据
 */
    async Uartterminaldatatransfinites() {
        console.log('清洗告警数据');
        console.time('Uartterminaldatatransfinites')
        const MapUartterminaldatatransfinites: Map<string, Uart.uartAlarmObject> = new Map()
        const Mode = this.logs.getModel(UartTerminalDataTransfinite)
        const Query = Mode.find({ "__v": 0 })
        const cur = Query.cursor()
        const len = await Query.countDocuments()
        const deleteids: Types.ObjectId[] = []
        const allids: Types.ObjectId[] = []
        for (let doc = await cur.next(); doc != null; doc = await cur.next()) {
            const tag = doc.mac + doc.pid + doc.tag
            const _id = Types.ObjectId(doc._id)
            allids.push(_id)
            const old = MapUartterminaldatatransfinites.get(tag)
            if (old && old.msg === doc.msg) {
                // 比较同一个设备连续的告警,告警相同则删除后一个记录
                deleteids.push(_id)
            } else {
                MapUartterminaldatatransfinites.set(tag, doc)
            }
        }

        // 批量删除告警日志
        await Mode.deleteMany({ _id: { $in: deleteids } }).exec()
        // 更新标签
        await Mode.updateMany({ _id: { $in: allids } }, { $inc: { "__v": 1 as any } }).exec()
        console.timeEnd('Uartterminaldatatransfinites');
        return deleteids.length + '/' + len
    }

    /**
     * 清洗请求数据
     */
    async CleanUserRequst() {
        console.log('清洗请求数据');
        console.time('CleanUserRequst')
        const MapUserRequst: Map<string, Uart.logUserRequst> = new Map()
        const Mode = this.logs.getModel(UserRequst)
        const Query = Mode.find({ "__v": 0 })
        const cur = Query.cursor()
        const len = await Query.countDocuments()
        const deleteids: Types.ObjectId[] = []
        const allids: Types.ObjectId[] = []
        for (let doc = await cur.next(); doc != null; doc = await cur.next()) {
            const tag = doc.user + doc.type
            const _id = Types.ObjectId(doc._id)
            allids.push(_id)
            const old = MapUserRequst.get(tag)
            // 比较同一个设备连续的告警,告警相同则删除后一个记录
            if (old && JSON.stringify(doc.argument) === JSON.stringify(old.argument) || !doc.type) {
                deleteids.push(_id)
            }
            else MapUserRequst.set(tag, doc)
        }
        // 批量删除告警日志
        await Mode.deleteMany({ _id: { $in: deleteids } }).exec()
        // 更新标签
        await Mode.updateMany({ _id: { $in: allids } }, { $inc: { "__v": 1 as any } }).exec()
        console.timeEnd('CleanUserRequst')
        // 清除缓存
        return deleteids.length + '/' + len
    }

    /**
 * 清洗设备原始Result
 * 把所有不在现有dtu列表的设备结果集删除
 */
    async CleanClientresults() {
        console.log('清洗设备原始Result');
        console.time('CleanClientresults')
        const MapClientresults: Map<string, Map<string, string>> = new Map()
        // 文档实例
        const ColltionMode = this.logs.getModel(TerminalClientResult)
        const sMode = this.logs.getModel(TerminalClientResults)

        const sQuery = sMode.find({ "__v": 0 })
        const scur = sQuery.cursor()

        const len = await sQuery.countDocuments()
        const deleteids: string[] = []
        const allids: string[] = []

        console.log({ len });

        for (let doc = await this.next(scur); doc != null; doc = await this.next(scur)) {
            const _id: string = doc._id
            const oldDoc = MapClientresults.get(_id)
            if (oldDoc) {
                // 比较每个content查询下buffer.data的数据，有不一致则更新缓存，一致的话计入待删除array
                const isrepeat = doc.contents.some(el => {
                    const oldData = oldDoc.get(el.content)
                    return !oldData || oldData !== el.data.toString()
                })
                if (isrepeat) MapClientresults.set(_id, new Map(doc.contents.map(el => [el.content, el.data.toString()])))
                else {
                    deleteids.push(_id)
                }
            } else {
                MapClientresults.set(_id, new Map(doc.contents.map(el => [el.content, el.data.toString()])))
            }
            allids.push(_id)
        }
        console.log({ deleteids: deleteids.length, allids: allids.length, MapClientresults: MapClientresults.size });
        MapClientresults.clear()

        const statData = await ColltionMode.find({ parentId: { $in: deleteids }, hasAlarm: 0 }, { parentId: 1 }).lean()
        const statIds = statData.map(el => el.parentId)

        await sMode.deleteMany({ _id: { $in: statIds.map(el => Types.ObjectId(el)) } })
        await ColltionMode.deleteMany({ parentId: { $in: statIds } })
        // 更新标签
        await sMode.updateMany({ _id: { $in: allids.map(el => Types.ObjectId(el)) } }, { $inc: { "__v": 1 } }).exec()
        console.timeEnd('CleanClientresults')
        return deleteids.length + '/' + len
    }

    next<T>(curs: QueryCursor<DocumentType<T>>) {
        return new Promise<DocumentType<T>>(resolve => {
            curs.next((err, doc) => {
                resolve(doc)
            })
        })
    }

    /**
 * 把所有一个月前的设备结果集删除
 */
    async CleanClientresultsTimeOut() {
        console.log('把所有一个月前的设备结果集删除');
        console.time("CleanClientresultsTimeOut")
        const lastM = Date.now() - (2.592e9 * 2)
        const ColltionMode = this.logs.getModel(TerminalClientResult)
        const sMode = this.logs.getModel(TerminalClientResults)
        const len = await ColltionMode.countDocuments()
        const docs = await ColltionMode.find({ timeStamp: { $lte: lastM } }, { parentId: 1 }).lean()

        await sMode.deleteMany({ _id: { $in: docs.map(el => Types.ObjectId(el.parentId)) } })
        const result = await ColltionMode.deleteMany({ timeStamp: { $lte: lastM } })
        console.timeEnd("CleanClientresultsTimeOut")
        return result.deletedCount + '/' + len
    }


    /**
     * 清洗dtuBusy
     */
    async CleanDtuBusy() {
        console.log('清洗dtuBusy');
        console.time("CleanDtuBusy")
        const BusyMap: Map<string, { _id: Types.ObjectId } & Uart.logDtuBusy> = new Map()
        const Mode = this.logs.getModel(DtuBusy)
        const cur = Mode.find({ "__v": 0 }).cursor()
        const deleteIds: Types.ObjectId[] = []
        const allIds: Types.ObjectId[] = []
        for (let doc = await cur.next(); doc != null; doc = await cur.next()) {
            const old = BusyMap.get(doc.mac)
            if (old && (doc.timeStamp === old.timeStamp || doc.stat === old.stat)) {
                deleteIds.push(old._id)
                // await LogDtuBusy.deleteOne({ _id: old._id })
                BusyMap.set(doc.mac, doc)
            } else BusyMap.set(doc.mac, doc)
            allIds.push(doc._id)
        }
        //await LogDtuBusy.remove({ _id: { $in: deleteIds } })
        // 一次性处理的条目数量太多,切块后多次处理
        const deleteChunk = chunk(deleteIds, 10000)
        for (let del of deleteChunk) {
            await Mode.deleteMany({ _id: { $in: del } })
        }
        const updateChunk = chunk(allIds, 10000)
        for (let update of updateChunk) {
            await Mode.updateMany({ _id: { $in: update } }, { $set: { "__v": 1 } })
        }
        console.timeEnd("CleanDtuBusy")
        //await LogDtuBusy.deleteMany({})
    }

}