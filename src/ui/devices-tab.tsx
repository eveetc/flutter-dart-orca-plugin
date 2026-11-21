// Devices tab: connected devices, emulators/simulators, creating Android emulators from installed images.
import { Badge, Button, Card, Collapsible, Grid, Input, Link, List, ListItem, read, Row, Select, set, Stack, Text } from 'orca'
import { actions, busy, emulatorId, emulatorName, imageId, latitude, locationDevice, longitude, options, snapshot } from './state.ts'

const places: [string, string, string][] = [['Zurich', '47.3769', '8.5417'], ['London', '51.5072', '-0.1276'], ['New York', '40.7128', '-74.0060'], ['San Francisco', '37.7749', '-122.4194'], ['Tokyo', '35.6762', '139.6503'], ['Sydney', '-33.8688', '151.2093']]

/** GPS position for Android emulators (adb emu geo fix) and, on a Mac, iOS simulators. */
function Location() {
  const state = read(snapshot)
  const emulators = state.devices.filter(device => device.emulator && (device.platform.startsWith('android') || device.platform === 'ios'))
  if (!emulators.length) return null
  const device = emulators.some(item => item.id === read(locationDevice)) ? read(locationDevice) : emulators[0].id
  const valid = Math.abs(Number(read(latitude))) <= 90 && Math.abs(Number(read(longitude))) <= 180 && read(latitude).trim() !== '' && read(longitude).trim() !== ''
  return (
    <Card title="Location" description="Move an emulator's GPS, for testing maps and location features.">
      <Stack gap="sm">
        {emulators.length > 1 ? <Select label="Emulator" value={device} options={emulators.map(item => ({ value: item.id, label: item.name }))} onChange={value => set(locationDevice, value)} /> : null}
        <Select label="Place" value="" placeholder="Pick a city, or type coordinates below" options={places.map(([name]) => ({ value: name, label: name }))} onChange={value => { const place = places.find(([name]) => name === value)!; set(latitude, place[1]); set(longitude, place[2]) }} />
        <Grid columns={2} gap="sm">
          <Input label="Latitude" value={read(latitude)} placeholder="47.3769" maxLength={12} invalid={!valid} onChange={value => set(latitude, value.trim())} />
          <Input label="Longitude" value={read(longitude)} placeholder="8.5417" maxLength={12} invalid={!valid} onChange={value => set(longitude, value.trim())} />
        </Grid>
        <Button size="sm" variant="outline" icon="globe" disabled={!!read(busy) || !valid} onPress={() => { set(locationDevice, device); void actions.setLocation() }}>Set location</Button>
      </Stack>
    </Card>
  )
}

export function DevicesTab() {
  const state = read(snapshot)
  const idle = !read(busy) && !!state.selection
  const disabled = !idle || state.jobs.some(job => job.status === 'running')
  const target = read(options).deviceId
  const targetName = state.devices.find(device => device.id === target)?.name
  return (
    <Stack gap="md">
      <Card title="Connected devices" description="Phones, emulators, desktop and web targets Flutter can run on.">
        <Stack gap="sm">
          {state.devices.length ? <List label="Connected devices">{state.devices.map(device =>
            <ListItem title={device.name} description={`${device.platform}${device.emulator ? ' · emulator' : ''} · ${device.id}`} icon={device.emulator ? 'layers' : device.platform.startsWith('web') ? 'globe' : 'zap'} current={device.id === target} disabled={!idle} onPress={() => actions.useDevice(device.id)} />)}
          </List> : <Text muted size="sm">No devices found yet. Connect a phone with USB debugging, start an emulator, then refresh.</Text>}
          <Row gap="sm" justify="between" align="center">
            {target ? <Badge tone="accent">{`Run target: ${targetName ?? target}`}</Badge> : <Text muted size="xs">Select a device to make it the run target.</Text>}
            <Button size="sm" variant="outline" icon="refresh" disabled={!idle} onPress={actions.refresh}>Refresh</Button>
          </Row>
        </Stack>
      </Card>
      <Card title="Emulators & simulators">
        <Stack gap="sm">
          <Select label="Emulator" value={read(emulatorId)} placeholder={state.emulators.length ? 'Choose an emulator' : 'Refresh to find emulators'} disabled={disabled} options={state.emulators.map(emulator => ({ value: emulator.id, label: `${emulator.name} · ${emulator.platform}` }))} onChange={value => set(emulatorId, value)} />
          <Button size="sm" variant="outline" icon="play" disabled={disabled || !read(emulatorId)} onPress={actions.launchEmulator}>Launch emulator</Button>
          <Text muted size="xs">When it has booted, refresh to see it under Connected devices. Orca’s built-in emulator tab can show its screen.</Text>
        </Stack>
      </Card>
      <Location />
      <Collapsible title="Create Android emulator" description="From a system image already installed on this computer.">
        <Stack gap="sm">
          <Grid minItemWidth="sm" gap="sm">
            <Input label="Name" value={read(emulatorName)} maxLength={50} disabled={disabled} onChange={value => set(emulatorName, value)} />
            <Select label="System image" value={read(imageId)} placeholder="No installed images" disabled={disabled} options={state.images.map(image => ({ value: image.id, label: image.label }))} onChange={value => set(imageId, value)} />
          </Grid>
          <Button size="sm" variant="outline" icon="add" disabled={disabled || !read(imageId) || !read(emulatorName)} onPress={actions.createEmulator}>Create emulator</Button>
          <Text muted size="xs">Install images and accept their licenses in Android Studio’s SDK Manager.</Text>
          <Link href="https://developer.android.com/studio/run/managing-avds">Android virtual device setup</Link>
        </Stack>
      </Collapsible>
    </Stack>
  )
}
