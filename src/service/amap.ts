import { Provide, Inject } from "@midwayjs/decorator"
import axios from "axios"
import { RedisService } from "../service/redis"

type apiType = 'ip' | 'geocode/geo' | 'geocode/regeo' | 'assistant/coordinate/convert'


@Provide()
export class Amap {

    @Inject()
    RedisService: RedisService


    /**
     * ip转gps
     * @param ip 
     */
    async IP2loction(ip: string) {
        if (!await this.RedisService.getloctionIp(ip)) {
            const result = await this.fecth<Uart.AMap.ip2parameters>('ip', { ip })
            const loction = result.rectangle.split(";")[0]
            this.RedisService.setloctionIp(ip, loction)
        }
        return await this.RedisService.getloctionIp(ip)
    }

    /**
     *  GPS转高德坐标系
     * @param loctions 经纬度
     * @param coordsys 定位编码
     */
    async GPS2autonavi(loctions: string | string[], coordsys: "gps" | 'mapbar' | 'baidu' = "gps") {
        if (!loctions || loctions === '') return ['']
        const result = await this.fecth<Uart.AMap.convert>('assistant/coordinate/convert', { locations: loctions, coordsys })
        // console.log({ GPS2autonavi: result, locations: loctions, coordsys });
        return result.status === '1' ? result.locations.split(";") : ['']
    }

    // axios
    private async fecth<T extends Uart.AMap.statu>(type: apiType, data: { [x: string]: string | string[] }) {
        const res = await axios({
            url: "https://restapi.amap.com/v3/" + type,
            params: {
                key: "0e99d0426f1afb11f2b95864ebd898d0",
                ...data
            }
        })
        const result: T = res.data;
        if (result.status === '0') {
            console.log(result);
        }
        return result;
    }
}