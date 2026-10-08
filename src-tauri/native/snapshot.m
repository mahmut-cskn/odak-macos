#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
void odak_snapshot_webview(void *rawWebview, const char *file) {
    WKWebView *webview = (__bridge WKWebView *)rawWebview;
    NSString *path = [NSString stringWithUTF8String:file];
    [webview takeSnapshotWithConfiguration:nil completionHandler:^(NSImage *image, NSError *error) {
        if (error || !image) { NSLog(@"Odak snapshot failed: %@", error); return; }
        NSBitmapImageRep *rep = [NSBitmapImageRep imageRepWithData:image.TIFFRepresentation];
        NSData *data = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
        [data writeToFile:path atomically:YES];
    }];
}
