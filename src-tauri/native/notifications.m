#import <AppKit/AppKit.h>
#import <UserNotifications/UserNotifications.h>

// The Tauri notification plugin's desktop permission API always reports Granted.
// Use the native center so macOS presents its real permission prompt.
@interface OdakNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>
@end
@implementation OdakNotificationDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter *)center willPresentNotification:(UNNotification *)notification withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completion {
    completion(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList | UNNotificationPresentationOptionSound);
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center didReceiveNotificationResponse:(UNNotificationResponse *)response withCompletionHandler:(void (^)(void))completion {
    dispatch_async(dispatch_get_main_queue(), ^{
        [NSApp activateIgnoringOtherApps:YES];
        for (NSWindow *window in NSApp.windows) {
            if ([window.title isEqualToString:@"Odak"]) { [window makeKeyAndOrderFront:nil]; break; }
        }
    });
    completion();
}
@end
static OdakNotificationDelegate *odakDelegate;
void odak_request_notification_permission(void) {
    @autoreleasepool {
        if (!odakDelegate) odakDelegate = [OdakNotificationDelegate new];
        UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
        center.delegate = odakDelegate;
        [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge) completionHandler:^(BOOL granted, NSError *error) {
            (void)granted;
            if (error) NSLog(@"Odak notification authorization: %@", error);
        }];
    }
}
int odak_send_notification(const char *title, const char *body, bool sound) {
    @autoreleasepool {
        UNMutableNotificationContent *content = [UNMutableNotificationContent new];
        content.title = [NSString stringWithUTF8String:title];
        content.body = [NSString stringWithUTF8String:body];
        if (sound) content.sound = [UNNotificationSound defaultSound];
        UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:[[NSUUID UUID] UUIDString] content:content trigger:nil];
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
        __block int result = 0;
        [[UNUserNotificationCenter currentNotificationCenter] addNotificationRequest:request withCompletionHandler:^(NSError *error) {
            if (error) { NSLog(@"Odak notification: %@", error); result = 1; }
            dispatch_semaphore_signal(semaphore);
        }];
        if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC))) return 2;
        return result;
    }
}
