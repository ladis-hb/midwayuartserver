import { Rule, RuleType } from "@midwayjs/decorator"
import { Types } from "mongoose"

/**
 * 日期参数
 */
export class date {
    @Rule(RuleType.string().allow())
    start?: string

    @Rule(RuleType.string().allow())
    end?: string

    getStart() {
        return new Date(this.start).getTime()
    }

    getEnd() {
        return new Date(this.end).getTime()
    }
}

@Rule(date)
export class macDate extends date {
    @Rule(RuleType.string())
    mac: string
}

@Rule(date)
export class IdDate extends date {
    @Rule(RuleType.string().allow())
    id?: string

    getId() {
        return Types.ObjectId(this.id)
    }
}