import { describe, expect, it } from 'vitest'
import { parseLsblk } from '../../src/main/hal/sources'

describe('HAL: detección de memorias USB (lsblk)', () => {
  it('encuentra la partición montada de una memoria USB y omite discos internos y loops', () => {
    const json = JSON.stringify({
      blockdevices: [
        {
          name: 'loop0',
          size: 4096,
          type: 'loop',
          mountpoints: ['/snap/bare/5'],
          label: null,
          tran: null,
          rm: false,
          hotplug: false,
          model: null,
          fstype: 'squashfs'
        },
        {
          name: 'nvme0n1',
          size: 512e9,
          type: 'disk',
          mountpoints: [null],
          label: null,
          tran: 'nvme',
          rm: false,
          hotplug: false,
          model: 'SSD',
          fstype: null,
          children: [
            {
              name: 'nvme0n1p2',
              size: 500e9,
              type: 'part',
              mountpoints: ['/'],
              label: null,
              tran: 'nvme',
              rm: false,
              hotplug: false,
              model: null,
              fstype: 'ext4'
            }
          ]
        },
        {
          name: 'sdb',
          size: 16e9,
          type: 'disk',
          mountpoints: [null],
          label: null,
          tran: 'usb',
          rm: true,
          hotplug: true,
          model: 'DataTraveler 3.0 ',
          fstype: null,
          children: [
            {
              name: 'sdb1',
              size: 16e9,
              type: 'part',
              mountpoints: ['/media/juan/KINGSTON'],
              label: 'KINGSTON',
              tran: null,
              rm: true,
              hotplug: true,
              model: null,
              fstype: 'vfat'
            }
          ]
        }
      ]
    })
    expect(parseLsblk(json)).toEqual([
      {
        id: 'sdb1',
        label: 'KINGSTON',
        mount: '/media/juan/KINGSTON',
        sizeBytes: 16e9,
        model: 'DataTraveler 3.0',
        fstype: 'vfat'
      }
    ])
  })

  it('una memoria conectada pero sin montar no se usa', () => {
    const json = JSON.stringify({
      blockdevices: [
        {
          name: 'sdc',
          size: 8e9,
          type: 'disk',
          mountpoints: [null],
          label: 'X',
          tran: 'usb',
          rm: true,
          hotplug: true,
          model: 'X',
          fstype: 'vfat'
        }
      ]
    })
    expect(parseLsblk(json)).toEqual([])
  })
})
